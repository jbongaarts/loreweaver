/**
 * Race / ancestry parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` already narrowed to the races section of
 * the SRD (see `sections.ts`); output is an `AncestryExtraction[]`, sorted by
 * name, with one entry per race AND one per subrace.
 *
 * SRD 5.1 uses the term "race"; per ADR 0005 the importer normalizes the
 * record kind to `ancestry` while preserving the source term in record data
 * (`emit.ts` sets `data.source = 'race'`).
 *
 * Subrace decision (recorded on loreweaver-0m9.5.6): parent races and subraces
 * are emitted as **separate** records, and each subrace record is
 * **self-contained / flattened** — its trait list already merges the parent's
 * shared traits with the subrace's own additions, so a name lookup of e.g.
 * "Hill Dwarf" resolves to a fully usable record without resolving the parent.
 * `subraceOf` names the parent; the parent lists its children in `subraces`.
 *
 * Boundary detection mirrors the conservative known-name approach used by the
 * condition / hazard / action parsers: a line is a race or subrace heading only
 * when it exactly equals one of the known SRD 5.1 race / subrace names. This is
 * deterministic and resistant to false positives from body prose (which never
 * appears as a bare heading-only line). Trait sub-entries inside a block are
 * detected by the SRD's "Label. body" paragraph shape.
 */

import type { AncestryExtraction, AncestryTrait, PageText } from './types.js';

interface FlatLine {
  readonly line: string;
  readonly page: number;
}

function flatten(pages: readonly PageText[]): readonly FlatLine[] {
  const out: FlatLine[] = [];
  for (const page of pages) {
    for (const line of page.lines) {
      out.push({ line, page: page.pageNumber });
    }
  }
  return out;
}

// The nine SRD 5.1 races. Used as exact full-line heading anchors.
const KNOWN_RACES: readonly string[] = [
  'Dwarf',
  'Elf',
  'Halfling',
  'Human',
  'Dragonborn',
  'Gnome',
  'Half-Elf',
  'Half-Orc',
  'Tiefling',
];

interface KnownSubrace {
  /** Exact heading text as printed in the SRD. */
  readonly sourceName: string;
  /** Canonical record display name. Usually the heading, except bare halflings. */
  readonly recordName: string;
  readonly parent: string;
}

// The SRD 5.1 subraces and their parent races. Most record names are kept
// verbatim from the source headings; the bare halfling headings are
// parent-qualified so canonical name/key lookups match user-facing terms.
const KNOWN_SUBRACES: readonly KnownSubrace[] = [
  { sourceName: 'Hill Dwarf', recordName: 'Hill Dwarf', parent: 'Dwarf' },
  {
    sourceName: 'Mountain Dwarf',
    recordName: 'Mountain Dwarf',
    parent: 'Dwarf',
  },
  { sourceName: 'High Elf', recordName: 'High Elf', parent: 'Elf' },
  { sourceName: 'Wood Elf', recordName: 'Wood Elf', parent: 'Elf' },
  {
    sourceName: 'Dark Elf (Drow)',
    recordName: 'Dark Elf (Drow)',
    parent: 'Elf',
  },
  {
    sourceName: 'Lightfoot',
    recordName: 'Lightfoot Halfling',
    parent: 'Halfling',
  },
  {
    sourceName: 'Stout',
    recordName: 'Stout Halfling',
    parent: 'Halfling',
  },
  { sourceName: 'Forest Gnome', recordName: 'Forest Gnome', parent: 'Gnome' },
  { sourceName: 'Rock Gnome', recordName: 'Rock Gnome', parent: 'Gnome' },
];

const RACE_SET = new Set(KNOWN_RACES);
const SUBRACE_BY_SOURCE_NAME = new Map(
  KNOWN_SUBRACES.map((s) => [s.sourceName, s]),
);
const SUBRACE_BY_RECORD_NAME = new Map(
  KNOWN_SUBRACES.map((s) => [s.recordName, s]),
);

// "Label. body" trait line: a short Title-Case noun-phrase label, then a
// period, a space, and body text. Labels are letters with single internal
// separators (space, apostrophe, slash, parens, hyphen); commas and digits in
// the label position break the match (so body sentences are not mis-promoted).
const TRAIT_LABEL_RE = /^([A-Z][A-Za-z]+(?:[ '/()-][A-Za-z]+)*)\.\s+(\S.*)$/;

// Sentence-starter words that begin benefit prose, never a trait label. Mirrors
// the body-prose guard in parseFeats so a wrapped body sentence ending mid-line
// ("Your size is Medium. You ...") is not promoted to a bogus trait.
const PROSE_STARTERS = new Set([
  'You',
  'Your',
  'The',
  'A',
  'An',
  'This',
  'These',
  'When',
  'While',
  'If',
  'As',
  'Once',
  'At',
  'In',
  'On',
  'For',
  'To',
  'By',
  'With',
  'Choose',
]);

function matchTraitLabel(line: string): { label: string; body: string } | null {
  const m = TRAIT_LABEL_RE.exec(line.trim());
  if (m === null) return null;
  const label = m[1].trim();
  const words = label.split(/\s+/);
  if (label.length > 40 || words.length > 6) return null;
  if (PROSE_STARTERS.has(words[0])) return null;
  return { label, body: m[2].trim() };
}

/** Re-flow wrapped lines into paragraph-separated prose (blank line = break). */
function joinParagraphs(lines: readonly string[]): string {
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) {
      if (current.length > 0) {
        paragraphs.push(current.join(' '));
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) {
    paragraphs.push(current.join(' '));
  }
  return paragraphs.join('\n\n').trim();
}

interface RawBlock {
  readonly name: string;
  readonly description: string;
  readonly traits: readonly AncestryTrait[];
  readonly sourcePage: number;
}

interface Boundary {
  readonly idx: number;
  readonly name: string;
  readonly isRace: boolean;
  readonly parent?: string;
}

/** Parse a single race/subrace block body into description + traits. */
function parseBlock(
  name: string,
  bodyLines: readonly string[],
  sourcePage: number,
): RawBlock {
  // Drop a leading "<Name> Traits" sub-header line if present.
  const lines = bodyLines.filter(
    (l) => l.trim() !== `${name} Traits` && l.trim() !== `${name} Traits.`,
  );

  // Find the first trait-label line; everything before it is flavor/description.
  let firstTraitIdx = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (matchTraitLabel(lines[i]) !== null) {
      firstTraitIdx = i;
      break;
    }
  }

  const description = joinParagraphs(lines.slice(0, firstTraitIdx));

  const traits: AncestryTrait[] = [];
  let currentLabel: string | null = null;
  let currentBody: string[] = [];
  const flushTrait = () => {
    if (currentLabel !== null) {
      traits.push({
        name: currentLabel,
        text: joinParagraphs(currentBody),
      });
    }
    currentLabel = null;
    currentBody = [];
  };
  for (let i = firstTraitIdx; i < lines.length; i++) {
    const match = matchTraitLabel(lines[i]);
    if (match !== null) {
      flushTrait();
      currentLabel = match.label;
      currentBody = [match.body];
    } else if (currentLabel !== null) {
      currentBody.push(lines[i]);
    }
  }
  flushTrait();

  return { name, description, traits, sourcePage };
}

function findTrait(
  traits: readonly AncestryTrait[],
  name: string,
): AncestryTrait | undefined {
  return traits.find((t) => t.name === name);
}

function parseSize(traits: readonly AncestryTrait[]): string | undefined {
  const size = findTrait(traits, 'Size');
  if (size === undefined) return undefined;
  const m = /\b(Tiny|Small|Medium|Large|Huge|Gargantuan)\b/.exec(size.text);
  return m?.[1];
}

function parseSpeed(traits: readonly AncestryTrait[]): number | undefined {
  const speed = findTrait(traits, 'Speed');
  if (speed === undefined) return undefined;
  const m = /(\d+)\s*(?:feet|ft\.?)/i.exec(speed.text);
  return m ? Number.parseInt(m[1], 10) : undefined;
}

/**
 * Flatten parent + subrace traits into a self-contained list. Parent traits
 * come first (minus the parent's "Subrace" pointer trait); a subrace trait that
 * shares a parent trait's label appends to it (e.g. an additive Ability Score
 * Increase) rather than duplicating the label.
 */
function mergeTraits(
  parent: readonly AncestryTrait[],
  child: readonly AncestryTrait[],
): AncestryTrait[] {
  const merged: AncestryTrait[] = parent
    .filter((t) => t.name !== 'Subrace')
    .map((t) => ({ ...t }));
  for (const trait of child) {
    const existingIdx = merged.findIndex((t) => t.name === trait.name);
    if (existingIdx >= 0) {
      merged[existingIdx] = {
        name: trait.name,
        text: `${merged[existingIdx].text} ${trait.text}`.trim(),
      };
    } else {
      merged.push({ ...trait });
    }
  }
  return merged;
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * Parse race + subrace entries from the narrowed races-section `PageText[]`.
 * Returns an `AncestryExtraction[]` sorted by name; parents and subraces are
 * each their own entry, and subrace entries carry flattened (parent + own)
 * traits.
 */
export function parseAncestries(
  pages: readonly PageText[],
): AncestryExtraction[] {
  const flat = flatten(pages);
  if (flat.length === 0) return [];

  // First pass: locate race / subrace heading lines (exact full-line match).
  const boundaries: Boundary[] = [];
  for (let i = 0; i < flat.length; i++) {
    const trimmed = flat[i].line.trim();
    if (RACE_SET.has(trimmed)) {
      boundaries.push({ idx: i, name: trimmed, isRace: true });
    } else {
      const subrace = SUBRACE_BY_SOURCE_NAME.get(trimmed);
      if (subrace !== undefined) {
        boundaries.push({
          idx: i,
          name: subrace.recordName,
          isRace: false,
          parent: subrace.parent,
        });
      }
    }
  }
  if (boundaries.length === 0) return [];

  // Second pass: parse each block body up to the next boundary.
  const raceBlocks = new Map<string, RawBlock>();
  const subraceBlocks = new Map<string, RawBlock>();
  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    const bodyStart = b.idx + 1;
    const bodyEnd = boundaries[i + 1]?.idx ?? flat.length;
    const bodyLines = flat.slice(bodyStart, bodyEnd).map((f) => f.line);
    const block = parseBlock(b.name, bodyLines, flat[b.idx].page);
    if (b.isRace) {
      raceBlocks.set(b.name, block);
    } else {
      subraceBlocks.set(b.name, block);
    }
  }

  // Build child lists for each parent, preserving document order.
  const childrenOf = new Map<string, string[]>();
  for (const b of boundaries) {
    if (b.isRace) continue;
    const parent = b.parent;
    if (parent === undefined) continue;
    const list = childrenOf.get(parent) ?? [];
    list.push(b.name);
    childrenOf.set(parent, list);
  }

  const out: AncestryExtraction[] = [];

  // Parent race records.
  for (const [name, block] of raceBlocks) {
    const subraces = childrenOf.get(name);
    out.push({
      name,
      description: block.description,
      traits: block.traits,
      ...(parseSize(block.traits) !== undefined
        ? { size: parseSize(block.traits) }
        : {}),
      ...(parseSpeed(block.traits) !== undefined
        ? { speed: parseSpeed(block.traits) }
        : {}),
      ...(subraces !== undefined && subraces.length > 0 ? { subraces } : {}),
      sourcePage: block.sourcePage,
    });
  }

  // Subrace records (flattened with parent traits).
  for (const [name, block] of subraceBlocks) {
    const parentName = SUBRACE_BY_RECORD_NAME.get(name)?.parent;
    const parentBlock =
      parentName !== undefined ? raceBlocks.get(parentName) : undefined;
    const flattened =
      parentBlock !== undefined
        ? mergeTraits(parentBlock.traits, block.traits)
        : [...block.traits];
    out.push({
      name,
      description: block.description,
      traits: flattened,
      ...(parseSize(flattened) !== undefined
        ? { size: parseSize(flattened) }
        : {}),
      ...(parseSpeed(flattened) !== undefined
        ? { speed: parseSpeed(flattened) }
        : {}),
      ...(parentName !== undefined ? { subraceOf: parentName } : {}),
      sourcePage: block.sourcePage,
    });
  }

  out.sort(byName);
  return out;
}
