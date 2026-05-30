/**
 * Subclass parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` already narrowed to the SRD's "Classes"
 * chapter (the orchestrator in `index.ts` reuses the same `classes` slice it
 * feeds `parseClasses`, since each subclass is described inside its parent
 * class's section). Output is a `SubclassExtraction[]`, sorted by name, with one
 * entry per SRD 5.1 subclass.
 *
 * Scope (ADR 0009 / loreweaver-0m9.5.17): **subclasses only** (Champion, Life
 * domain, School of Evocation, …). Base classes are `class` records parsed by
 * `parseClasses` (loreweaver-0m9.5.2); class features are a separate `feature`
 * kind (loreweaver-0m9.5.18) and are NOT extracted here — a subclass's granted
 * features ride along in its re-flowed `description` prose for now, and the
 * optional `data.features` reference array is left for the feature parser.
 *
 * Boundary detection mirrors the conservative known-name approach used by the
 * ancestry / condition / hazard / action parsers: a line is a subclass heading
 * only when it exactly equals one of the known SRD 5.1 subclass names. The same
 * file also knows the 12 base-class names (the subclass parents), which serve as
 * additional description boundaries so the next class's intro prose cannot bleed
 * into the previous subclass's body. Per ADR 0007 only these structural anchors
 * (names + the subclass→parent relationship that is a fact of the SRD's
 * organization) are hard-coded; every field VALUE (`description`) is extracted
 * from the source, never authored from model knowledge.
 *
 * Parent linkage: each subclass carries its parent base-class NAME, which
 * `emit.ts` keys to the parent `class:<slug>` record under `data.parentClass`
 * (ADR 0009 data-side linkage; never `overrides`). This mirrors how
 * `parseAncestries` carries `subraceOf` as a name that emit keys.
 *
 * Fail-closed: a confirmed subclass (a known heading found in the slice) whose
 * body re-flows to an empty string is a malformed entry — the subclass
 * kindSchema requires a non-empty `description` — so the parser throws with the
 * subclass name + page rather than emit a record that can't satisfy the schema.
 */

import type { PageText, SubclassExtraction } from './types.js';

interface KnownSubclass {
  /** Exact heading text as printed in the SRD (also the record name). */
  readonly name: string;
  /** Parent base-class name. */
  readonly parent: string;
}

// The 12 SRD 5.1 subclasses (one per base class) and their parent classes.
// Names are kept verbatim from the source headings; the parent relationship is
// a structural fact of the SRD's organization (the subclass is printed inside
// the parent class's section). Used as exact full-line heading anchors.
const KNOWN_SUBCLASSES: readonly KnownSubclass[] = [
  { name: 'Path of the Berserker', parent: 'Barbarian' },
  { name: 'College of Lore', parent: 'Bard' },
  { name: 'Life Domain', parent: 'Cleric' },
  { name: 'Circle of the Land', parent: 'Druid' },
  { name: 'Champion', parent: 'Fighter' },
  { name: 'Way of the Open Hand', parent: 'Monk' },
  { name: 'Oath of Devotion', parent: 'Paladin' },
  { name: 'Hunter', parent: 'Ranger' },
  { name: 'Thief', parent: 'Rogue' },
  { name: 'Draconic Bloodline', parent: 'Sorcerer' },
  { name: 'The Fiend', parent: 'Warlock' },
  { name: 'School of Evocation', parent: 'Wizard' },
];

const SUBCLASS_BY_NAME = new Map(KNOWN_SUBCLASSES.map((s) => [s.name, s]));
// The 12 base-class names. Used only as description boundaries (the start of
// the next class's section ends the previous subclass's body).
const PARENT_CLASS_NAMES = new Set(KNOWN_SUBCLASSES.map((s) => s.parent));

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

/**
 * Parse subclass entries from the narrowed Classes-chapter `PageText[]`.
 * Returns a `SubclassExtraction[]` sorted by name.
 */
export function parseSubclasses(
  pages: readonly PageText[],
): SubclassExtraction[] {
  const flat = flatten(pages);
  if (flat.length === 0) return [];

  // Boundary lines: any subclass heading OR any base-class name (both exact
  // full-line matches). A subclass's description runs from its heading to the
  // next boundary, so the next class's name + intro prose does not bleed into
  // the previous subclass's body.
  const boundaries: number[] = [];
  for (let i = 0; i < flat.length; i++) {
    const trimmed = flat[i].line.trim();
    if (SUBCLASS_BY_NAME.has(trimmed) || PARENT_CLASS_NAMES.has(trimmed)) {
      boundaries.push(i);
    }
  }

  const out: SubclassExtraction[] = [];
  for (let b = 0; b < boundaries.length; b++) {
    const idx = boundaries[b];
    const name = flat[idx].line.trim();
    const known = SUBCLASS_BY_NAME.get(name);
    // A base-class-name boundary is not itself a subclass — skip it.
    if (known === undefined) continue;

    const bodyStart = idx + 1;
    const bodyEnd = boundaries[b + 1] ?? flat.length;
    const description = joinParagraphs(
      flat.slice(bodyStart, bodyEnd).map((f) => f.line),
    );

    // A confirmed subclass with no body is malformed (or a layout these anchors
    // don't yet match) — fail closed rather than emit a record that violates
    // the kindSchema's non-empty `description` requirement.
    if (description.length === 0) {
      throw new Error(
        `subclass "${name}" at page ${flat[idx].page} has no description text`,
      );
    }

    out.push({
      name,
      parentClass: known.parent,
      description,
      sourcePage: flat[idx].page,
    });
  }

  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}
