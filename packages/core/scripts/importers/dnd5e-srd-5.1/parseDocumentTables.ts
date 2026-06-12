/**
 * Document-wide table parser for the D&D 5e SRD 5.1 importer (eshyra-4a7.3).
 *
 * Where `parseTables.ts` reconstructs reference tables from specific section
 * slices using text-only anchors, this parser consumes the FULL extracted
 * document and locates each table by typography: a reviewed anchor heading at
 * the record-leaf font tier (h≈12.0, `PageText.lineHeights`) followed by the
 * table's exact column-header line(s) at the table-cell tier (h≈8.9). Row
 * collection consumes ONLY cell-tier lines, so a table can never swallow the
 * body prose that resumes below it, and a prose sidebar (whose box body also
 * renders at cell height) can never satisfy a spec because the exact header
 * line will not match.
 *
 * Every emitted table is a reviewed spec in `SRD_5_1_DOCUMENT_TABLE_SPECS`:
 * name (verbatim caption, or a documented synthesized name when the SRD
 * prints the table caption-less), columns, header lines, a row-collection
 * rule, and an EXACT expected row count. A spec whose anchor matches but
 * whose rows drift in count or shape yields no table (fail closed): the
 * record then goes missing from `EXPECTED_SRD_5_1_TABLE_NAMES` and the
 * import throws `TableCoverageError` before writing output.
 *
 * Anchor kinds:
 *   - `caption`: the anchor heading IS the printed table caption and the
 *     header line follows immediately (e.g. "Draconic Ancestry" p5,
 *     "Oath of Devotion Spells" p33, "The Barbarian" p8).
 *   - `item`: the SRD prints the table caption-less inside a record entry;
 *     the anchor is the OWNING entry's heading (e.g. the "Wand of Wonder"
 *     magic-item heading) and the table is the first cell-tier run after it.
 *     Scanning aborts at the next leaf-or-higher heading so a spec can never
 *     claim a different entry's table.
 *
 * Two same-caption tables ("Draconic Ancestry" p5 vs the Sorcerer p44 copy)
 * disambiguate by their different exact header lines; the parser tries every
 * anchor occurrence until the headers verify.
 *
 * Fixture safety: reduced/uniform-font fixture PDFs render every line in one
 * band, so the leaf-anchor + cell-header requirement never matches and the
 * parser emits nothing — document-table coverage is asserted only for the
 * real import via the table-name baseline.
 */

import { classifyTier, isTableCell } from './sourceInventory.js';
import type { PageText, TableExtraction } from './types.js';

interface Row {
  readonly page: number;
  readonly text: string;
  readonly height: number | undefined;
}

/** How rows are reconstructed from the table's cell-tier run. */
type RowRule =
  | {
      /** Every row is one cell line matching `pattern`; group i+1 is column i. */
      readonly kind: 'line-per-row';
      readonly pattern: RegExp;
      /** Column indexes (0-based) whose cells emit as integers. */
      readonly integerColumns?: readonly number[];
    }
  | {
      /**
       * A row starts at a line matching `start`; subsequent non-matching cell
       * lines re-join (hyphen-aware) into the LAST captured column's cell —
       * the SRD wraps only the final text column in these tables.
       */
      readonly kind: 'wrapped-last-column';
      readonly start: RegExp;
    }
  | {
      /**
       * The Barbarian progression shape: a row line carries all five cells
       * ("1st +2 Rage, 2 +2") but the Features cell (group 3) wraps onto
       * following cell lines ("Unarmored" / "Defense") that re-join into it.
       */
      readonly kind: 'wrapped-features-column';
      readonly start: RegExp;
    };

export interface DocumentTableSpec {
  /** Emitted table name (verbatim caption, or synthesized — see specs). */
  readonly name: string;
  readonly columns: readonly string[];
  /** Exact trimmed text of the anchor heading line. */
  readonly anchorHeading: string;
  /** Whether the anchor is the printed caption or the owning entry heading. */
  readonly anchor: 'caption' | 'item';
  /**
   * Exact trimmed text of the table's column-header line(s) at cell tier,
   * in order. The first header line is also the spec's disambiguator when
   * the anchor heading text repeats in the document.
   */
  readonly headerLines: readonly string[];
  readonly rows: RowRule;
  /** Exact source row count; any drift fails the table closed. */
  readonly expectedRows: number;
}

const ORDINAL_LEVEL = String.raw`\d{1,2}(?:st|nd|rd|th)`;

/** "<ordinal> <spells…>" rows (subclass spell tables). */
const LEVEL_SPELLS_ROW = new RegExp(`^(${ORDINAL_LEVEL})\\s+(.+)$`);

/**
 * Wrapped-d100 row start: a d100 range ("02–10", "98–00") or a zero-padded
 * single value ("01", "00"). The zero-pad requirement keeps a wrapped effect
 * cell that happens to begin with a bare number ("10 gems worth…") from
 * opening a phantom row.
 */
const D100_WRAPPED_ROW_START = /^(\d{2,3}\s*[–—-]\s*\d{1,3}|0\d)\s+(.+)$/;

const DRAGON_COLOR =
  'Black|Blue|Brass|Bronze|Copper|Gold|Green|Red|Silver|White';
const DRAGON_DAMAGE = 'Acid|Cold|Fire|Lightning|Poison';

/** The ten SRD circle-of-the-land terrains, each printed as a bare caption. */
const CIRCLE_OF_THE_LAND_TERRAINS: readonly string[] = [
  'Arctic',
  'Coast',
  'Desert',
  'Forest',
  'Grassland',
  'Mountain',
  'Swamp',
];

function levelSpellsSpec(input: {
  readonly name: string;
  readonly anchorHeading: string;
  readonly levelColumn: string;
  readonly spellsColumn: string;
  readonly headerLines: readonly string[];
  readonly expectedRows: number;
}): DocumentTableSpec {
  return {
    name: input.name,
    columns: [input.levelColumn, input.spellsColumn],
    anchorHeading: input.anchorHeading,
    anchor: 'caption',
    headerLines: input.headerLines,
    rows: { kind: 'wrapped-last-column', start: LEVEL_SPELLS_ROW },
    expectedRows: input.expectedRows,
  };
}

function bagOfTricksSpec(color: string): DocumentTableSpec {
  return {
    name: `${color} Bag of Tricks`,
    columns: ['d8', 'Creature'],
    anchorHeading: `${color} Bag of Tricks`,
    anchor: 'caption',
    headerLines: ['d8 Creature'],
    rows: {
      kind: 'line-per-row',
      pattern: /^([1-8])\s+(.+)$/,
      integerColumns: [0],
    },
    expectedRows: 8,
  };
}

/**
 * The reviewed document-wide table specs for the vendored SRD 5.1 PDF.
 * Grouped by source region; every entry names its source page and, when the
 * SRD prints the table caption-less, documents the synthesized name.
 */
export const SRD_5_1_DOCUMENT_TABLE_SPECS: readonly DocumentTableSpec[] = [
  // --- Races (p5) + the Sorcerer Draconic Bloodline copy (p44) --------------
  // Same printed caption twice; the exact header line disambiguates. The p44
  // table drops the Breath Weapon column, so it is a distinct table; its name
  // is synthesized ("Draconic Bloodline Draconic Ancestry") because a second
  // record cannot reuse the verbatim caption name/key.
  {
    name: 'Draconic Ancestry',
    columns: ['Dragon', 'Damage Type', 'Breath Weapon'],
    anchorHeading: 'Draconic Ancestry',
    anchor: 'caption',
    headerLines: ['Dragon Damage Type Breath Weapon'],
    rows: {
      kind: 'line-per-row',
      pattern: new RegExp(`^(${DRAGON_COLOR})\\s+(${DRAGON_DAMAGE})\\s+(.+)$`),
    },
    expectedRows: 10,
  },
  {
    name: 'Draconic Bloodline Draconic Ancestry',
    columns: ['Dragon', 'Damage Type'],
    anchorHeading: 'Draconic Ancestry',
    anchor: 'caption',
    headerLines: ['Dragon Damage Type'],
    rows: {
      kind: 'line-per-row',
      pattern: new RegExp(`^(${DRAGON_COLOR})\\s+(${DRAGON_DAMAGE})$`),
    },
    expectedRows: 10,
  },
  // --- Class chapters: progression + option tables --------------------------
  // The Barbarian (p8) is the one SRD class progression table whose columns
  // all live on one physical line per row (the spellcaster tables split their
  // slot columns into a separate block — left to eshyra-4a7.6's progression
  // modeling). The Features cell wraps onto continuation cell lines.
  {
    name: 'The Barbarian',
    columns: ['Level', 'Proficiency Bonus', 'Features', 'Rages', 'Rage Damage'],
    anchorHeading: 'The Barbarian',
    anchor: 'caption',
    headerLines: ['Proficiency Rage', 'Level Bonus Features Rages Damage'],
    rows: {
      kind: 'wrapped-features-column',
      start: new RegExp(
        `^(${ORDINAL_LEVEL})\\s+(\\+\\d)\\s+(.+?)\\s+(\\d+|Unlimited)\\s+(\\+\\d)$`,
      ),
    },
    expectedRows: 20,
  },
  // Sorcerer Font of Magic option table (p43).
  {
    name: 'Creating Spell Slots',
    columns: ['Spell Slot Level', 'Sorcery Point Cost'],
    anchorHeading: 'Creating Spell Slots',
    anchor: 'caption',
    headerLines: ['Spell Slot Sorcery', 'Level Point Cost'],
    rows: {
      kind: 'line-per-row',
      pattern: /^([1-5](?:st|nd|rd|th))\s+(\d+)$/,
      integerColumns: [1],
    },
    expectedRows: 5,
  },
  // Subclass spell tables: Life Domain (p17), Circle of the Land's seven
  // terrain tables (p22 — bare "Arctic"…"Swamp" captions, so the names are
  // qualified "Circle of the Land (<Terrain>)"), Oath of Devotion (p33), and
  // the Fiend patron's expanded list (p50).
  levelSpellsSpec({
    name: 'Life Domain Spells',
    anchorHeading: 'Life Domain Spells',
    levelColumn: 'Cleric Level',
    spellsColumn: 'Spells',
    headerLines: ['Cleric Level Spells'],
    expectedRows: 5,
  }),
  ...CIRCLE_OF_THE_LAND_TERRAINS.map((terrain) =>
    levelSpellsSpec({
      name: `Circle of the Land (${terrain})`,
      anchorHeading: terrain,
      levelColumn: 'Druid Level',
      spellsColumn: 'Circle Spells',
      headerLines: ['Druid Level Circle Spells'],
      expectedRows: 4,
    }),
  ),
  levelSpellsSpec({
    name: 'Oath of Devotion Spells',
    anchorHeading: 'Oath of Devotion Spells',
    levelColumn: 'Paladin Level',
    spellsColumn: 'Spells',
    headerLines: ['Paladin', 'Level Spells'],
    expectedRows: 5,
  }),
  levelSpellsSpec({
    name: 'Fiend Expanded Spells',
    anchorHeading: 'Fiend Expanded Spells',
    levelColumn: 'Spell Level',
    spellsColumn: 'Spells',
    headerLines: ['Spell Level Spells'],
    expectedRows: 5,
  }),
  // --- Equipment chapter (p64) ----------------------------------------------
  {
    name: 'Donning and Doffing Armor',
    columns: ['Category', 'Don', 'Doff'],
    anchorHeading: 'Donning and Doffing Armor',
    anchor: 'caption',
    headerLines: ['Category Don Doff'],
    rows: {
      kind: 'line-per-row',
      pattern:
        /^(Light Armor|Medium Armor|Heavy Armor|Shield)\s+(\d+ minutes?|\d+ action)\s+(\d+ minutes?|\d+ action)$/,
    },
    expectedRows: 4,
  },
  // --- Magic Items A-Z: representative embedded tables ----------------------
  // The three Bag of Tricks color tables print real captions (p210-211).
  ...['Gray', 'Rust', 'Tan'].map(bagOfTricksSpec),
  // Belt of Giant Strength (p211) and Potion of Giant Strength (p234) print
  // caption-less variety tables inside their entries; the names are
  // synthesized from the owning item. Their distinct header lines keep the
  // two near-identical tables apart.
  {
    name: 'Belt of Giant Strength',
    columns: ['Type', 'Strength', 'Rarity'],
    anchorHeading: 'Belt of Giant Strength',
    anchor: 'item',
    headerLines: ['Type Strength Rarity'],
    rows: {
      kind: 'line-per-row',
      pattern: /^(.+?)\s+(\d+)\s+(Uncommon|Rare|Very rare|Legendary)$/,
      integerColumns: [1],
    },
    expectedRows: 5,
  },
  {
    name: 'Potion of Giant Strength',
    columns: ['Type of Giant', 'Strength', 'Rarity'],
    anchorHeading: 'Potion of Giant Strength',
    anchor: 'item',
    headerLines: ['Type of Giant Strength Rarity'],
    rows: {
      kind: 'line-per-row',
      pattern: /^(.+?)\s+(\d+)\s+(Uncommon|Rare|Very rare|Legendary)$/,
      integerColumns: [1],
    },
    expectedRows: 5,
  },
  // Potions of Healing (p234) prints a real caption; the "Potion of …" column
  // header keeps its verbatim ellipsis.
  {
    name: 'Potions of Healing',
    columns: ['Potion of …', 'Rarity', 'HP Regained'],
    anchorHeading: 'Potions of Healing',
    anchor: 'caption',
    headerLines: ['Potion of … Rarity HP Regained'],
    rows: {
      kind: 'line-per-row',
      pattern: /^(.+?)\s+(Common|Uncommon|Rare|Very rare)\s+(.+)$/,
    },
    expectedRows: 4,
  },
  // Wrapped-d100 dice-result tables, printed caption-less inside their items;
  // names synthesized from the owning item. Rows are Madness-table-shaped:
  // a d100 range (or zero-padded single value) opens a row and following
  // cell lines re-join into the effect cell. Bag of Beans (p209-210) and
  // Gray Bag of Tricks-style page breaks are handled by the flattened
  // cross-page line walk.
  {
    name: 'Bag of Beans',
    columns: ['d100', 'Effect'],
    anchorHeading: 'Bag of Beans',
    anchor: 'item',
    headerLines: ['d100 Effect'],
    rows: { kind: 'wrapped-last-column', start: D100_WRAPPED_ROW_START },
    expectedRows: 12,
  },
  {
    name: 'Robe of Useful Items',
    columns: ['d100', 'Patch'],
    anchorHeading: 'Robe of Useful Items',
    anchor: 'item',
    headerLines: ['d100 Patch'],
    rows: { kind: 'wrapped-last-column', start: D100_WRAPPED_ROW_START },
    expectedRows: 13,
  },
  {
    name: 'Wand of Wonder',
    columns: ['d100', 'Effect'],
    anchorHeading: 'Wand of Wonder',
    anchor: 'item',
    headerLines: ['d100 Effect'],
    rows: { kind: 'wrapped-last-column', start: D100_WRAPPED_ROW_START },
    expectedRows: 22,
  },
];

function flatten(pages: readonly PageText[]): readonly Row[] {
  return pages.flatMap((page) =>
    page.lines.map((text, lineIndex) => ({
      page: page.pageNumber,
      text: text.trim(),
      height: page.lineHeights?.[lineIndex],
    })),
  );
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Hyphen-aware wrapped-cell join (same convention as parseTables.ts). */
function joinWrappedCell(parts: readonly string[]): string {
  let out = '';
  for (const raw of parts) {
    const part = normalizeWhitespace(raw);
    if (part.length === 0) continue;
    if (out.endsWith('-') && /^[a-z]/.test(part)) {
      out += part;
    } else {
      out += `${out.length === 0 ? '' : ' '}${part}`;
    }
  }
  return out;
}

/** True when the line renders at the record-leaf-or-higher heading tiers. */
function isHeadingTier(height: number | undefined): boolean {
  const tier = classifyTier(height);
  return (
    tier === 'chapter' ||
    tier === 'section' ||
    tier === 'subsection' ||
    tier === 'leaf'
  );
}

/** How many lines an `item`-anchored spec may scan for its header line. */
const MAX_ITEM_BODY_SCAN_LINES = 120;

/**
 * Locate the spec's header-line position: the index of the FIRST header line.
 * For `caption` anchors the header must follow the anchor immediately; for
 * `item` anchors the header must be the first cell-tier line of the entry
 * body, before any other heading. Returns undefined when the headers do not
 * verify at this anchor occurrence.
 */
function findHeaderAt(
  rows: readonly Row[],
  anchorIdx: number,
  spec: DocumentTableSpec,
): number | undefined {
  let headerIdx: number | undefined;
  if (spec.anchor === 'caption') {
    headerIdx = anchorIdx + 1;
  } else {
    const end = Math.min(rows.length, anchorIdx + 1 + MAX_ITEM_BODY_SCAN_LINES);
    for (let i = anchorIdx + 1; i < end; i++) {
      if (isHeadingTier(rows[i].height)) return undefined; // next entry began
      if (isTableCell(rows[i].height)) {
        headerIdx = i;
        break;
      }
    }
  }
  if (headerIdx === undefined) return undefined;
  for (let h = 0; h < spec.headerLines.length; h++) {
    const row = rows[headerIdx + h];
    if (row === undefined) return undefined;
    if (!isTableCell(row.height)) return undefined;
    if (normalizeWhitespace(row.text) !== spec.headerLines[h]) {
      return undefined;
    }
  }
  return headerIdx;
}

/** The contiguous cell-tier run starting right after the header lines. */
function cellRunAfter(
  rows: readonly Row[],
  headerIdx: number,
  headerLineCount: number,
): readonly Row[] {
  const start = headerIdx + headerLineCount;
  let end = start;
  while (end < rows.length && isTableCell(rows[end].height)) end += 1;
  return rows.slice(start, end);
}

function collectRows(
  run: readonly Row[],
  rule: RowRule,
): readonly (readonly unknown[])[] {
  switch (rule.kind) {
    case 'line-per-row': {
      const out: (readonly unknown[])[] = [];
      for (const row of run) {
        const match = rule.pattern.exec(normalizeWhitespace(row.text));
        if (match === null) break;
        out.push(
          match
            .slice(1)
            .map((cell, columnIdx) =>
              (rule.integerColumns ?? []).includes(columnIdx)
                ? Number.parseInt(cell, 10)
                : cell,
            ),
        );
      }
      return out;
    }
    case 'wrapped-last-column': {
      const out: string[][] = [];
      for (const row of run) {
        const text = normalizeWhitespace(row.text);
        const match = rule.start.exec(text);
        if (match !== null) {
          out.push([
            ...match.slice(1, -1).map(normalizeWhitespace),
            match[match.length - 1],
          ]);
          continue;
        }
        if (out.length === 0) break;
        const last = out[out.length - 1];
        last[last.length - 1] = joinWrappedCell([last[last.length - 1], text]);
      }
      return out;
    }
    case 'wrapped-features-column': {
      const out: string[][] = [];
      for (const row of run) {
        const text = normalizeWhitespace(row.text);
        const match = rule.start.exec(text);
        if (match !== null) {
          out.push([match[1], match[2], match[3], match[4], match[5]]);
          continue;
        }
        if (out.length === 0) break;
        const last = out[out.length - 1];
        last[2] = joinWrappedCell([last[2], text]);
      }
      return out;
    }
  }
}

function parseSpec(
  rows: readonly Row[],
  spec: DocumentTableSpec,
): TableExtraction | undefined {
  for (let i = 0; i < rows.length; i++) {
    // Collapse inner whitespace: column-spaced headings ("School   of
    // Evocation") arrive with multi-space gaps.
    if (normalizeWhitespace(rows[i].text) !== spec.anchorHeading) continue;
    if (classifyTier(rows[i].height) !== 'leaf') continue;
    const headerIdx = findHeaderAt(rows, i, spec);
    if (headerIdx === undefined) continue; // try the next anchor occurrence
    const run = cellRunAfter(rows, headerIdx, spec.headerLines.length);
    const tableRows = collectRows(run, spec.rows);
    // Fail closed: a located table whose rows drift in count or shape emits
    // nothing, so the table-name baseline catches it before output is written.
    if (tableRows.length !== spec.expectedRows) return undefined;
    return {
      name: spec.name,
      columns: [...spec.columns],
      rows: tableRows,
      sourcePage: rows[headerIdx].page,
    };
  }
  return undefined;
}

/**
 * Parse every reviewed document-wide table spec against the full extracted
 * document. Specs whose anchors do not verify (reduced or uniform-font
 * fixtures) are skipped; the real import's table-name baseline enforces that
 * all of them parse. Results are name-sorted like `parseTables`.
 */
export function parseDocumentTables(
  pages: readonly PageText[],
  specs: readonly DocumentTableSpec[] = SRD_5_1_DOCUMENT_TABLE_SPECS,
): TableExtraction[] {
  const rows = flatten(pages);
  const tables = specs
    .map((spec) => parseSpec(rows, spec))
    .filter((table): table is TableExtraction => table !== undefined);
  tables.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return tables;
}
