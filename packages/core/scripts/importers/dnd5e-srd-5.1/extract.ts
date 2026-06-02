/**
 * PDF text extraction for the D&D 5e SRD 5.1 importer.
 *
 * Uses pdfjs-dist's "legacy" Node-friendly build to extract per-page text
 * content. The extractor groups text items into lines by their y-coordinate
 * (in PDF user space, origin at lower-left of the page) and sorts each line
 * left-to-right by x-coordinate.
 *
 * Column-aware emission: SRD 5.1 body chapters (spell descriptions, monster
 * stat blocks, …) render in two columns. pdfjs returns items in y-descending
 * order regardless of column, and items from both columns can share an
 * identical y-baseline (a wrap line at the bottom of one column lines up
 * exactly with a stat-block heading at the top of the next column on the
 * facing column). A naïve "bucket by y first" pass therefore concatenates
 * across columns into a single line ("… one Speed 40 ft., …"), erasing the
 * Speed row entirely. The extractor partitions ITEMS by x BEFORE bucketing
 * by y, then emits column-by-column (top-to-bottom within each column,
 * left-to-right between columns), which yields the natural reading order
 * with each column's contents kept intact. Pages whose item x values
 * collapse to a single cluster are emitted in their original y-descending
 * order, so single-column body pages and fixture PDFs are unaffected.
 *
 * Heading awareness: the SRD 5.1 PDF renders chapter titles ("Races",
 * "Equipment", "Using Ability Scores", "Appendix PH-A: Conditions") at a
 * larger font height than body prose. The extractor identifies items with
 * height ≥ `HEADING_H_THRESHOLD` as heading-class. Two consequences:
 *
 *   1. Multi-line chapter titles (e.g. "Using Ability" wrapping to "Scores"
 *      below it because the column is narrow) are merged back into a single
 *      logical line so `^Using Ability Scores$` anchors actually match.
 *
 *   2. Each `PageText` carries a `headingLineIndexes` array — indexes into
 *      `lines` for entries the extractor identified as chapter / section
 *      headings. The section slicer can opt into matching anchors only at
 *      these positions (see `matchHeadings` in `sections.ts`), so an
 *      `^Equipment$` line that appears as a class-block subsection at body
 *      font size does not shadow the actual "Equipment" chapter title even
 *      when their trimmed text is identical.
 *
 * Pure function: same PDF buffer always yields the same `PageText[]`.
 */

// pdfjs-dist's package "exports" map only exposes specific paths; "legacy/build/pdf.mjs" is the
// supported Node entry point that ships an ESM build without DOM-only code.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PageText } from './types.js';

// Minimal local shapes for pdfjs text-content items. The library's emitted
// types live behind a deep path (`pdfjs-dist/types/src/display/api`) that is
// not part of its public exports map; pinning a shallow structural type here
// avoids that coupling without losing meaningful type checking.
interface PdfTextItem {
  readonly str: string;
  readonly transform: readonly number[];
  readonly height: number;
  /**
   * Rendered width of the text run in PDF user-space points. pdfjs populates
   * this for every text item and the line-joining pass uses it to detect a
   * visible gap between adjacent items on the same baseline (e.g. a
   * bold/regular font switch like "Armor Class" + "17 (natural armor)"
   * where pdfjs reports two items with no whitespace between their strs).
   */
  readonly width?: number;
}
interface PdfTextContent {
  readonly items: readonly unknown[];
}

/** Round y to this many decimal places when grouping items into lines. */
const Y_GROUP_PRECISION = 1;

/**
 * Item rendered-height (in PDF user-space points) at or above which a text
 * item counts as a chapter / section heading. SRD 5.1 body prose renders at
 * h ≈ 9.8, sub-subsection titles at 12.0 / 13.9, subsection titles at 18.0,
 * and chapter titles at 25.9. The 14 cutoff captures h=18 subsection titles
 * (Spell Lists, Spell Descriptions, Actions in Combat, Multiclassing, ...)
 * and h=25.9 chapter titles while excluding body and sub-subsection text.
 */
const HEADING_H_THRESHOLD = 14;

/**
 * Item rendered-height threshold for the multi-line MERGE pass. Only the
 * largest chapter-title style (h ≈ 25.9 in SRD 5.1) is subject to merging,
 * because that is where the narrow-column wrap actually happens
 * ("Using Ability" / "Scores", "Appendix PH-A:" / "Conditions"). Subsection
 * titles at h=18 are short enough that they do not wrap in the SRD.
 */
const HEADING_MERGE_H_THRESHOLD = 20;

/** Tolerance in PDF user-space points for treating two items as same-column. */
const COLUMN_X_TOLERANCE = 2;

/**
 * Minimum visible gap (in PDF user-space points) between adjacent items on
 * the same baseline before the line-joining pass inserts a space between
 * them. pdfjs returns each font-style run as a separate item, so SRD 5.1
 * stat-block rows ("Armor Class" + "17 (natural armor)") arrive as two
 * items with no whitespace between their `str` values; without this gap
 * detection the joined text would read "Armor Class17 (natural armor)" and
 * the `^Armor Class\s+(\d+)` parser regex would never match. A 1pt gap is
 * tight enough not to inject spaces between truly abutting items (e.g.
 * intra-word style changes) while still catching the ~10pt gutter between
 * a stat label and its value.
 */
const ITEM_GAP_SPACE_THRESHOLD = 1;

/**
 * y-coordinate (PDF user space) at or below which a text item is treated as
 * the running page footer. The SRD 5.1 body pages print a footer band
 * ("System Reference Document 5.1" + page number) at y ≈ 31.9 on every page;
 * with column-aware emission those items would otherwise concatenate with
 * the bottom-of-column text and corrupt downstream parsers (e.g.
 * `parseSpells` saw a "Components: V" row immediately followed by the
 * footer and interpreted the SRD string as a continuation of the components
 * field). SRD 5.1 body content never descends below y ≈ 96, so a 45pt
 * cutoff drops the footer cleanly without risking any real content.
 */
const FOOTER_MAX_Y = 45;

/**
 * Minimum gap (in PDF user-space points) between adjacent sorted item x
 * values before they're split into separate columns. SRD 5.1 two-column
 * body pages have a left column at x ≈ 57 (continuation indents up to
 * ~144) and a right column at x ≈ 328 — gap ≈ 184. The largest intra-
 * column horizontal jump observed in the real PDF is the ability-score
 * row gap (251 → 328 = 77pt), so 50pt cleanly separates intra-column
 * tabbing from inter-column gutter.
 */
const COLUMN_GAP_THRESHOLD = 50;

/**
 * Minimum item count any candidate column must contain before
 * `partitionItemsByColumn` accepts a column-cut. Real SRD body columns
 * carry hundreds of items, so a min of 2 is comfortably permissive while
 * still rejecting one-row stray splits.
 */
const MIN_ITEMS_PER_COLUMN = 2;

/**
 * Minimum number of distinct rounded x-coordinates a candidate column
 * must contain. The real page-column gutter is the *only* gap in body
 * content where items on each side draw from a rich set of x indents
 * (left edge, wrap continuation, list-item dent, inline tabbing). A
 * multi-row label/value layout has every label at the same x and every
 * value at the same x, so each "side" of the candidate cut collapses to
 * a single distinct x — that's the signature this guard rejects, even
 * when the label/value x-gap exceeds `COLUMN_GAP_THRESHOLD`.
 */
const MIN_DISTINCT_X_PER_COLUMN = 2;

export interface ExtractOptions {
  /**
   * Page range to extract (1-based, inclusive). If omitted, extracts all
   * pages. Useful for tests and for partial-PDF debugging.
   */
  readonly pageRange?: { start: number; end: number };
}

export async function extractPdfText(
  buffer: Uint8Array,
  options: ExtractOptions = {},
): Promise<PageText[]> {
  // Defensive copy: pdfjs documents detach the input buffer in some builds.
  const owned = new Uint8Array(buffer);
  const loadingTask = getDocument({
    data: owned,
    // Silence font / cmap warnings; we only consume extracted text.
    verbosity: 0,
  });
  const pdf = await loadingTask.promise;
  try {
    const start = options.pageRange?.start ?? 1;
    const end = options.pageRange?.end ?? pdf.numPages;
    interface RawPage {
      readonly pageNumber: number;
      readonly lines: readonly string[];
      readonly headingLineIndexes: readonly number[];
      readonly hasHeadingItem: boolean;
    }
    const raw: RawPage[] = [];
    for (let i = start; i <= end; i++) {
      const page = await pdf.getPage(i);
      try {
        const content = await page.getTextContent();
        const { lines, headingLineIndexes, hasHeadingItem } =
          textContentToPage(content);
        raw.push({
          pageNumber: i,
          lines,
          headingLineIndexes,
          hasHeadingItem,
        });
      } finally {
        page.cleanup();
      }
    }
    // Document-level fall-back: when NO page contained any heading-class
    // item (e.g. fixture PDFs built with a uniform font size), don't carry
    // an empty `headingLineIndexes` array on each page — leave it
    // undefined so anchors with `matchHeadings: true` fall back to line
    // matching. When even ONE page has heading info, every page gets a
    // `headingLineIndexes` array (possibly empty for content-only pages);
    // the anchor stays heading-scoped so a body line spelling the regex
    // can't lock the slice onto the wrong place.
    const documentHasHeadings = raw.some((r) => r.hasHeadingItem);
    return raw.map((r) => ({
      pageNumber: r.pageNumber,
      lines: r.lines,
      ...(documentHasHeadings
        ? { headingLineIndexes: r.headingLineIndexes }
        : {}),
    }));
  } finally {
    await pdf.cleanup();
    await pdf.destroy();
  }
}

interface LineRecord {
  /** Items contributing to this line, left-to-right within the y bucket. */
  readonly items: readonly PdfTextItem[];
  /** Joined and trimmed text for this line. */
  readonly text: string;
  /** y-coordinate (rounded) of the line in PDF user space. */
  readonly y: number;
  /** Minimum x-coordinate of any item in the line. */
  readonly minX: number;
  /** Maximum rendered height of any item in the line. */
  readonly maxH: number;
  /** True when every item in the line has h ≥ HEADING_MERGE_H_THRESHOLD. */
  readonly isMergeHeading: boolean;
  /** True when every item in the line has h ≥ HEADING_H_THRESHOLD. */
  readonly isHeading: boolean;
}

function textContentToPage(content: PdfTextContent): {
  lines: readonly string[];
  headingLineIndexes: readonly number[];
  hasHeadingItem: boolean;
} {
  // pdfjs gives mixed items. Only text items carry a string we want; pdfjs
  // also emits zero-height "EOL" marker items (empty str, h=0) on the same
  // y as the line's real text — those would corrupt the heading-height
  // checks below (an empty marker on the same row as a chapter title would
  // make row.every(h ≥ threshold) false), so they're dropped up front.
  // Footer items (the persistent "System Reference Document 5.1 / <page#>"
  // band at y ≈ 31.9) are also dropped here so they don't appear as a
  // trailing line on every page's column-emit and corrupt parsers that
  // treat unrecognized lines as continuations of the previous field.
  const items: PdfTextItem[] = content.items.filter(
    (item): item is PdfTextItem => {
      if (
        typeof item !== 'object' ||
        item === null ||
        !('str' in item) ||
        !('transform' in item) ||
        !('height' in item)
      ) {
        return false;
      }
      const a = item as {
        str: unknown;
        height: unknown;
        transform: unknown;
      };
      if (
        typeof a.str !== 'string' ||
        a.str.length === 0 ||
        typeof a.height !== 'number' ||
        a.height <= 0
      ) {
        return false;
      }
      const t = a.transform as readonly number[];
      if (t.length < 6 || typeof t[5] !== 'number') return false;
      return t[5] >= FOOTER_MAX_Y;
    },
  );
  if (items.length === 0) {
    return { lines: [], headingLineIndexes: [], hasHeadingItem: false };
  }
  // Partition items into columns BEFORE y-bucketing. Two items on the same
  // y but in different columns (e.g. SRD page 299, where the previous
  // monster's body text ends in the left column at y=710.40 while Adult
  // Gold Dragon's "Speed" line begins in the right column at y=710.40)
  // must not share a row bucket — otherwise the joined line text becomes
  // "Breath Weapons … one Speed 40 ft., …" and the speed regex misses.
  const itemsByColumn = partitionItemsByColumn(items);
  const ordered: LineRecord[] = [];
  for (const columnItems of itemsByColumn) {
    const records = bucketItemsIntoRecords(columnItems);
    const merged = mergeWrappedHeadings(records, columnItems);
    ordered.push(...merged);
  }
  const lines = ordered.map((r) => r.text);
  const headingLineIndexes: number[] = [];
  for (let idx = 0; idx < ordered.length; idx++) {
    if (ordered[idx].isHeading) headingLineIndexes.push(idx);
  }
  const hasHeadingItem = items.some((it) => it.height >= HEADING_H_THRESHOLD);
  return { lines, headingLineIndexes, hasHeadingItem };
}

/**
 * Group items into y-buckets and build per-line records in y-descending
 * (top-of-page-first) order. Operates on a single column's items; cross-
 * column y-bucketing is the caller's responsibility.
 */
function bucketItemsIntoRecords(items: readonly PdfTextItem[]): LineRecord[] {
  if (items.length === 0) return [];
  const byY = new Map<number, PdfTextItem[]>();
  for (const item of items) {
    const y = round(item.transform[5], Y_GROUP_PRECISION);
    const bucket = byY.get(y);
    if (bucket === undefined) {
      byY.set(y, [item]);
    } else {
      bucket.push(item);
    }
  }
  const yKeys = Array.from(byY.keys()).sort((a, b) => b - a);
  const records: LineRecord[] = [];
  for (const y of yKeys) {
    const row = byY.get(y);
    if (row === undefined) continue;
    row.sort((a, b) => a.transform[4] - b.transform[4]);
    const text = joinRowText(row);
    if (text.length === 0) continue;
    const minX = Math.min(...row.map((i) => i.transform[4]));
    const maxH = Math.max(...row.map((i) => i.height));
    records.push({
      items: row,
      text,
      y,
      minX,
      maxH,
      isMergeHeading: row.every((i) => i.height >= HEADING_MERGE_H_THRESHOLD),
      isHeading: row.every((i) => i.height >= HEADING_H_THRESHOLD),
    });
  }
  return records;
}

/**
 * Pick at most one column cut — the LARGEST x-gap on the page — and
 * return up to two columns of items in left-to-right order. Pages whose
 * largest gap falls below `COLUMN_GAP_THRESHOLD` (or whose candidate
 * split fails the per-column validation below) return a single bucket
 * containing all items, so single-column pages and uniform-font fixture
 * PDFs round-trip unchanged.
 *
 * Why item-level (not row-level) partitioning: a row spanning two columns
 * (the previous spell's wrap line in the left column at the same y as the
 * next spell's name in the right column) shares a y-bucket only because
 * the items happen to share an identical baseline. Splitting at the item
 * level keeps each column's reading order intact — the merged-text "Breath
 * Weapons … one Speed 40 ft., …" was the exact symptom of partitioning
 * after y-bucketing rather than before.
 *
 * Why a single largest cut (not every gap above the threshold): a
 * repeated label/value layout (e.g. a stat block printing "Armor Class
 * 17" / "Hit Points 178" / "Speed 40 ft." with labels at x=60 and
 * values at x=130) has only one x-gap on the page, and that gap can
 * easily exceed `COLUMN_GAP_THRESHOLD` even though it's an intra-column
 * tab stop, not a page-column gutter. Picking the single largest gap
 * and validating it (item count + distinct-x diversity on each side)
 * rejects that case while still catching the real SRD two-column body.
 */
function partitionItemsByColumn(
  items: readonly PdfTextItem[],
): readonly (readonly PdfTextItem[])[] {
  if (items.length <= 1) return [items];
  const sortedXs = items
    .map((it) => it.transform[4])
    .slice()
    .sort((a, b) => a - b);
  let largestGap = 0;
  let cutAt = -1;
  for (let i = 1; i < sortedXs.length; i++) {
    const gap = sortedXs[i] - sortedXs[i - 1];
    if (gap > largestGap) {
      largestGap = gap;
      cutAt = (sortedXs[i] + sortedXs[i - 1]) / 2;
    }
  }
  if (largestGap < COLUMN_GAP_THRESHOLD) return [items];
  const left: PdfTextItem[] = [];
  const right: PdfTextItem[] = [];
  for (const item of items) {
    if (item.transform[4] < cutAt) left.push(item);
    else right.push(item);
  }
  // Item-count guard: protects one-row fixtures and stray-item splits.
  if (
    left.length < MIN_ITEMS_PER_COLUMN ||
    right.length < MIN_ITEMS_PER_COLUMN
  ) {
    return [items];
  }
  // Distinct-x guard: protects repeated label/value layouts. A real
  // page column has body content at multiple x indents; a label or a
  // value column collapses to a single distinct x.
  if (
    distinctRoundedXCount(left) < MIN_DISTINCT_X_PER_COLUMN ||
    distinctRoundedXCount(right) < MIN_DISTINCT_X_PER_COLUMN
  ) {
    return [items];
  }
  return [left, right];
}

function distinctRoundedXCount(items: readonly PdfTextItem[]): number {
  const xs = new Set<number>();
  for (const item of items) {
    xs.add(Math.round(item.transform[4]));
  }
  return xs.size;
}

/**
 * Concatenate the strings of items on the same baseline, injecting a space
 * between adjacent items when their visual x-gap exceeds
 * `ITEM_GAP_SPACE_THRESHOLD` and neither end already carries whitespace.
 * This is the join used to derive a line's text. The pre-existing naive
 * `.join('')` was correct for items whose `str` carried their own
 * inter-run spacing, but SRD 5.1 stat blocks render "Armor Class" (bold)
 * and "17 (natural armor)" (regular) as two abutting items with no
 * whitespace in either `str`; joining without a gap-aware space produces
 * "Armor Class17 (natural armor)" and the stat-line regexes miss.
 */
function joinRowText(row: readonly PdfTextItem[]): string {
  if (row.length === 0) return '';
  let text = row[0].str;
  for (let i = 1; i < row.length; i++) {
    const prev = row[i - 1];
    const curr = row[i];
    const prevWidth = prev.width ?? 0;
    const prevEndX = prev.transform[4] + prevWidth;
    const currStartX = curr.transform[4];
    const gap = currStartX - prevEndX;
    const prevEndsWithSpace = /\s$/.test(prev.str);
    const currStartsWithSpace = /^\s/.test(curr.str);
    if (
      gap > ITEM_GAP_SPACE_THRESHOLD &&
      !prevEndsWithSpace &&
      !currStartsWithSpace
    ) {
      text += ' ';
    }
    text += curr.str;
  }
  return text.trim();
}

/**
 * Merge chapter-title lines that wrap across two or more visual rows in the
 * same column. The SRD 5.1 PDF puts narrow chapter titles on a left sidebar
 * that wraps into two or three lines ("Using Ability" / "Scores",
 * "Appendix PH-A:" / "Conditions"); pdfjs sees each visual row as a separate
 * y-coordinate, and a side-by-side table in the opposite column interleaves
 * its own rows between them in y-desc order. Without merging, a section
 * anchor like `^Using Ability Scores$` cannot match the heading at all.
 *
 * Merging is intentionally conservative. For each heading line A, we scan
 * forward (descending y) and consider each subsequent line B:
 *   - lines in a different column are ignored (the sidebar table case);
 *   - the first line in the SAME column that is body-prose stops the scan
 *     (we have left the heading block);
 *   - a heading line in the same column is added to the merge group only if
 *     no other item exists in that column between A's y and B's y (so a
 *     subsection title or paragraph inside the heading sidebar would block).
 * Every item in the merged set must clear `HEADING_MERGE_H_THRESHOLD`, so
 * subsection titles (h=18 in the SRD) are never folded into chapter titles
 * (h=25.9) and body prose is never folded into anything.
 */
function mergeWrappedHeadings(
  records: readonly LineRecord[],
  allItems: readonly PdfTextItem[],
): LineRecord[] {
  const groups: number[][] = [];
  const claimed = new Set<number>();
  for (let i = 0; i < records.length; i++) {
    if (claimed.has(i)) continue;
    const head = records[i];
    if (!head.isMergeHeading) continue;
    const group = [i];
    let lastIdx = i;
    for (let j = i + 1; j < records.length; j++) {
      if (claimed.has(j)) continue;
      const next = records[j];
      const sameColumn = Math.abs(next.minX - head.minX) <= COLUMN_X_TOLERANCE;
      if (!sameColumn) continue;
      if (!next.isMergeHeading) break;
      const last = records[lastIdx];
      if (intersectingItemInColumn(allItems, last, next, head.minX)) break;
      group.push(j);
      lastIdx = j;
    }
    if (group.length > 1) {
      groups.push(group);
      for (const idx of group) claimed.add(idx);
    }
  }
  if (groups.length === 0) {
    return [...records];
  }
  const headIndex = new Map<number, number[]>();
  const dropped = new Set<number>();
  for (const group of groups) {
    headIndex.set(group[0], group);
    for (const idx of group.slice(1)) dropped.add(idx);
  }
  const out: LineRecord[] = [];
  for (let i = 0; i < records.length; i++) {
    if (dropped.has(i)) continue;
    const group = headIndex.get(i);
    if (group === undefined) {
      out.push(records[i]);
      continue;
    }
    const members = group.map((idx) => records[idx]);
    const mergedItems = members.flatMap((m) => m.items);
    out.push({
      items: mergedItems,
      text: members.map((m) => m.text).join(' '),
      y: members[0].y,
      minX: members[0].minX,
      maxH: Math.max(...members.map((m) => m.maxH)),
      isMergeHeading: true,
      isHeading: true,
    });
  }
  return out;
}

/**
 * True when any item in the heading's column lies strictly between two
 * candidate heading lines' y-coordinates. "Same column" means within
 * `COLUMN_X_TOLERANCE` of the supplied column anchor (the original heading's
 * minX, so a multi-line title with slight per-row x drift still anchors back
 * to the chapter title's column). This is what prevents a sidebar table on
 * the opposite half of the page from blocking the legitimate merge of two
 * chapter-title rows, while still refusing to merge across an intervening
 * subsection title or paragraph in the heading's own column.
 */
function intersectingItemInColumn(
  allItems: readonly PdfTextItem[],
  upper: LineRecord,
  lower: LineRecord,
  columnX: number,
): boolean {
  // Compare with the SAME rounding the line bucket uses, so an item whose
  // raw y happens to fall slightly below the rounded bucket key (e.g. raw
  // 664.59 in a bucket keyed at 664.6) is not falsely counted as "between"
  // the upper and lower bucket boundaries.
  const yHi = upper.y;
  const yLo = lower.y;
  for (const item of allItems) {
    const iy = round(item.transform[5], Y_GROUP_PRECISION);
    if (iy >= yHi || iy <= yLo) continue;
    const ix = item.transform[4];
    if (Math.abs(ix - columnX) <= COLUMN_X_TOLERANCE) {
      return true;
    }
  }
  return false;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
