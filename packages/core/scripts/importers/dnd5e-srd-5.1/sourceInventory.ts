/**
 * SRD source-structure inventory (eshyra-4a7.1).
 *
 * The SOURCE side of the source-coverage gate: a pure, deterministic scan of
 * extracted `PageText[]` that identifies every source structure requiring
 * accounting. Where `sourceCoverage.ts` is a hand-curated list of names known
 * to exist in the source, this module DERIVES the inventory from the PDF's
 * own typography, so source structures the importer has never heard of still
 * show up and must be accounted for (emitted, mapped to child data, ignored
 * with a reason, or tracked as a known gap — see sourceInventoryCoverage.ts).
 *
 * Classification is driven by per-line rendered font heights
 * (`PageText.lineHeights`, populated by `extract.ts` for the real SRD PDF).
 * Tier map, measured empirically against SRD_CC_v5.1.pdf (eshyra-4a7.1
 * design notes, 2026-06-11):
 *
 *   h≈25.9  chapter titles and class names            (25 lines)
 *   h≈18.0  section titles                            (105)
 *   h≈13.9  subsection headings, subclass names       (307)
 *   h≈12.0  record-leaf headings: spells, magic items,
 *           creatures, features, table captions       (1398)
 *   h≈10.8  sidebar / callout headings                (376)
 *   h≈10.0  page-1/2 legal front matter ONLY          (11; excluded)
 *   h≈9.8   body prose                                (excluded)
 *   h≈8.9   table cells and column headers            (2489)
 *
 * Structural classification layered on the tiers:
 *   - a heading whose next body line looks like a stat block's
 *     size/type/alignment line ("Medium undead, neutral evil") is a
 *     `stat-block` (catches embedded blocks like Avatar of Death p218);
 *   - a heading directly followed by table-cell-tier lines is a
 *     `table-caption` (Draconic Ancestry p5, The Barbarian p8);
 *   - a table-cell run NOT owned by a caption is emitted as a `table-shape`
 *     item so caption-less embedded tables (Ring of Resistance's d10 table)
 *     still demand accounting.
 *
 * Pages without `lineHeights` (uniform-font fixture PDFs) yield no items, so
 * fixture pipelines see an empty inventory and a trivially clean gate.
 *
 * Pure function: same pages always yield the same inventory, sorted in
 * reading order (page, then lineIndex).
 */

import type { PageText } from './types.js';

/** Typography tier of an inventoried heading (see module header for bands). */
export type SourceTier =
  | 'chapter'
  | 'section'
  | 'subsection'
  | 'leaf'
  | 'sidebar';

/** Structural shape of an inventoried source item. */
export type SourceStructure =
  | 'heading'
  | 'table-caption'
  | 'stat-block'
  | 'table-shape';

export interface SourceInventoryItem {
  /** Page the item starts on (PDF page number, 1-based). */
  readonly page: number;
  /** Index into that page's `lines` of the item's first line. */
  readonly lineIndex: number;
  /** Heading text (wrapped lines merged), or first row of a table-shape run. */
  readonly text: string;
  /** Typography tier; null for table-shape items (they are cell runs, not headings). */
  readonly tier: SourceTier | null;
  readonly structure: SourceStructure;
  /** Nearest preceding chapter-tier heading text; null before the first chapter. */
  readonly section: string | null;
  /** Nearest preceding heading text of any tier; null before the first heading. */
  readonly context: string | null;
}

// ---------------------------------------------------------------------------
// Height bands (PDF user-space points). Each band is centered on a measured
// tier with enough slack to absorb rounding, and the gaps between bands are
// deliberate: h≈10.0 (legal front matter) falls between SIDEBAR_MIN and
// TABLE_CELL_MAX, and h≈9.8 (body) below SIDEBAR_MIN — both excluded.
// ---------------------------------------------------------------------------

const CHAPTER_MIN = 22;
const SECTION_MIN = 15;
const SUBSECTION_MIN = 12.95;
const LEAF_MIN = 10.95;
const SIDEBAR_MIN = 10.4;
const TABLE_CELL_MIN = 8.5;
const TABLE_CELL_MAX = 9.3;

function classifyTier(height: number | undefined): SourceTier | null {
  if (height === undefined) return null;
  if (height >= CHAPTER_MIN) return 'chapter';
  if (height >= SECTION_MIN) return 'section';
  if (height >= SUBSECTION_MIN) return 'subsection';
  if (height >= LEAF_MIN) return 'leaf';
  if (height >= SIDEBAR_MIN) return 'sidebar';
  return null;
}

function isTableCell(height: number | undefined): boolean {
  return (
    height !== undefined && height >= TABLE_CELL_MIN && height <= TABLE_CELL_MAX
  );
}

/**
 * Stat-block discriminator: the line straight under a stat-block name is the
 * italic size/type/alignment line — "Medium undead, neutral evil",
 * "Large aberration, lawful evil". It renders at body height, so the shape of
 * the text is the signal: a size word, a type phrase, and a comma.
 */
const SIZE_TYPE_LINE =
  /^(?:Tiny|Small|Medium|Large|Huge|Gargantuan)\b[^.]*,/;

/**
 * Wrap-continuation discriminator. The extractor only re-merges wrapped
 * headings at the h≥14 anchor tiers, so sub-14 wraps reach the inventory as
 * adjacent same-tier lines. Measured against the real PDF, the document has
 * exactly 14 such adjacencies: 4 genuine wraps — every one breaking after a
 * continuation token ("Multiclass Spellcaster:", "…Detection and",
 * "…Resistances, and") — and 10 dragon-group collisions ("Black Dragon"
 * directly followed by "Ancient Black Dragon") that must stay separate. A
 * line is therefore a wrap head only when it ends in ":", ",", or a trailing
 * connective word.
 */
const WRAP_CONTINUATION = /(?:[:,]|\b(?:and|of|the|or|to|with|against|per))$/i;

/** One extracted line flattened into the document-wide reading order. */
interface Row {
  readonly page: number;
  readonly lineIndex: number;
  readonly text: string;
  readonly height: number | undefined;
}

/**
 * Build the source-structure inventory for `pages`. See the module header for
 * the classification model.
 */
export function buildSourceInventory(
  pages: readonly PageText[],
): readonly SourceInventoryItem[] {
  const rows: Row[] = pages.flatMap((p) =>
    p.lines.map((text, lineIndex) => ({
      page: p.pageNumber,
      lineIndex,
      text: text.trim(),
      height: p.lineHeights?.[lineIndex],
    })),
  );

  const items: SourceInventoryItem[] = [];
  let currentChapter: string | null = null;
  let lastHeading: string | null = null;

  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    const tier = classifyTier(row.height);

    if (tier !== null) {
      // Re-merge wrapped headings: adjacency alone is NOT sufficient (the
      // dragon group headings sit directly above the first dragon's name at
      // the same tier), so a continuation token must end the line too.
      let text = row.text;
      let end = i + 1;
      while (
        end < rows.length &&
        classifyTier(rows[end].height) === tier &&
        WRAP_CONTINUATION.test(text)
      ) {
        text = `${text} ${rows[end].text.trim()}`.trim();
        end += 1;
      }

      let structure: SourceStructure = 'heading';
      const next = rows[end];
      if (next !== undefined && isTableCell(next.height)) {
        structure = 'table-caption';
      } else if (next !== undefined && SIZE_TYPE_LINE.test(next.text)) {
        structure = 'stat-block';
      }

      items.push({
        page: row.page,
        lineIndex: row.lineIndex,
        text,
        tier,
        structure,
        section: tier === 'chapter' ? null : currentChapter,
        context: lastHeading,
      });

      if (tier === 'chapter') currentChapter = text;
      lastHeading = text;
      i = end;

      // A caption owns the table run that follows it: consume the run so it
      // is not double-counted as a separate table-shape item.
      if (structure === 'table-caption') {
        while (i < rows.length && isTableCell(rows[i].height)) i += 1;
      }
      continue;
    }

    if (isTableCell(row.height)) {
      // Caption-less table run: demand accounting for the table itself, with
      // the nearest preceding heading as locator context.
      const start = row;
      let end = i;
      while (end < rows.length && isTableCell(rows[end].height)) end += 1;
      items.push({
        page: start.page,
        lineIndex: start.lineIndex,
        text: start.text,
        tier: null,
        structure: 'table-shape',
        section: currentChapter,
        context: lastHeading,
      });
      i = end;
      continue;
    }

    i += 1;
  }

  return items;
}
