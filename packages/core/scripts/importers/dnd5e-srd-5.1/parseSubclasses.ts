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
 * kind (loreweaver-0m9.5.18) and are NOT extracted here — subclass-granted
 * features are parsed into separate feature records by `parseFeatures`; this
 * parser only emits the subclass's own prose description.
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
 * Whitespace normalization: like the base-class parser, every line is collapsed
 * to single spaces before matching (`normalizeLine`). `extract.ts` joins pdfjs
 * text items with no separator, so a column-spaced multi-word heading extracts
 * with runs of internal whitespace ("Life   Domain", "School\tof\tEvocation").
 * Normalizing first lets the single-spaced known names match the real extracted
 * shape rather than only pre-normalized fixtures.
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
export const KNOWN_SUBCLASSES: readonly KnownSubclass[] = [
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
export const PARENT_CLASS_NAMES = new Set(
  KNOWN_SUBCLASSES.map((s) => s.parent),
);

interface FlatLine {
  readonly line: string;
  readonly page: number;
}

/** Collapse internal whitespace runs to single spaces and trim. */
function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function flatten(pages: readonly PageText[]): readonly FlatLine[] {
  const out: FlatLine[] = [];
  for (const page of pages) {
    for (const line of page.lines) {
      out.push({ line: normalizeLine(line), page: page.pageNumber });
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

  // Boundary lines: any base-class name (which also moves a "current parent"
  // cursor) and any subclass heading whose known parent matches that cursor.
  // The parent guard disambiguates stray subclass-name occurrences that fall
  // inside the wrong chapter — e.g. the Barbarian level-20 capstone row
  // "Primal Champion" column-wraps in the SRD 5.1 PDF so that "Champion"
  // extracts on its own line, which has the same exact text as the Fighter
  // subclass Champion's heading. Without the guard, the parser emits a
  // duplicate `subclass:champion` record and the pack writer rejects it
  // (loreweaver-9bu).
  //
  // The slice begins AFTER the "Barbarian" chapter heading (consumed by
  // sectionAnchors.classes as the start anchor), so the implicit parent at
  // the slice's leading content is Barbarian. Test fixtures that include the
  // parent name explicitly as their first line override this default before
  // any subclass-name line is reached.
  const boundaries: number[] = [];
  let currentParent: string = 'Barbarian';
  for (let i = 0; i < flat.length; i++) {
    // `flat[i].line` is already whitespace-normalized (see `flatten`).
    const line = flat[i].line;
    if (PARENT_CLASS_NAMES.has(line)) {
      currentParent = line;
      boundaries.push(i);
      continue;
    }
    const sc = SUBCLASS_BY_NAME.get(line);
    if (sc !== undefined && sc.parent === currentParent) {
      boundaries.push(i);
    }
  }

  const out: SubclassExtraction[] = [];
  for (let b = 0; b < boundaries.length; b++) {
    const idx = boundaries[b];
    const name = flat[idx].line;
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
