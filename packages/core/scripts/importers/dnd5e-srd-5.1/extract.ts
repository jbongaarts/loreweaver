/**
 * PDF text extraction for the D&D 5e SRD 5.1 importer.
 *
 * Uses pdfjs-dist's "legacy" Node-friendly build to extract per-page text
 * content. The extractor groups text items into lines by their y-coordinate
 * (in PDF user space, origin at lower-left of the page) and sorts each line
 * left-to-right by x-coordinate. This is enough for the SRD 5.1's
 * predominantly single-column flowing body text; multi-column tables are not
 * reconstructed faithfully but the spell parser does not depend on them.
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
 *   2. Each `PageText` carries a `headings` array listing the chapter / section
 *      heading lines on that page. The section slicer can opt into matching
 *      anchors only against this subset (see `matchHeadings` in `sections.ts`),
 *      so an `^Equipment$` line that appears as a class-block subsection at
 *      body font size does not shadow the actual "Equipment" chapter title.
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
      readonly headings: readonly string[];
      readonly hasHeadingItem: boolean;
    }
    const raw: RawPage[] = [];
    for (let i = start; i <= end; i++) {
      const page = await pdf.getPage(i);
      try {
        const content = await page.getTextContent();
        const { lines, headings, hasHeadingItem } = textContentToPage(content);
        raw.push({ pageNumber: i, lines, headings, hasHeadingItem });
      } finally {
        page.cleanup();
      }
    }
    // Document-level fall-back: when NO page contained any heading-class
    // item (e.g. fixture PDFs built with a uniform font size), don't carry
    // an empty `headings` array on each page — leave it undefined so
    // anchors with `matchHeadings: true` fall back to line matching. When
    // even ONE page has heading info, every page gets a `headings` array
    // (possibly empty for content-only pages); the anchor stays heading-
    // scoped so a body line spelling the regex can't lock the slice onto
    // the wrong place.
    const documentHasHeadings = raw.some((r) => r.hasHeadingItem);
    return raw.map((r) => ({
      pageNumber: r.pageNumber,
      lines: r.lines,
      ...(documentHasHeadings ? { headings: r.headings } : {}),
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
  headings: readonly string[];
  hasHeadingItem: boolean;
} {
  // pdfjs gives mixed items. Only text items carry a string we want; pdfjs
  // also emits zero-height "EOL" marker items (empty str, h=0) on the same
  // y as the line's real text — those would corrupt the heading-height
  // checks below (an empty marker on the same row as a chapter title would
  // make row.every(h ≥ threshold) false), so they're dropped up front.
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
      const a = item as { str: unknown; height: unknown };
      return (
        typeof a.str === 'string' &&
        a.str.length > 0 &&
        typeof a.height === 'number' &&
        a.height > 0
      );
    },
  );
  if (items.length === 0) {
    return { lines: [], headings: [], hasHeadingItem: false };
  }
  // Group by y-coordinate (rounded). pdfjs's transform is a 6-element matrix
  // [a, b, c, d, e, f] where (e, f) is the translation; f is the y origin of
  // the text run. Items on the same baseline share f (modulo rounding).
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
  // Lines in reading order: high y first (top of page = greater y in PDF space).
  const yKeys = Array.from(byY.keys()).sort((a, b) => b - a);
  const records: LineRecord[] = [];
  for (const y of yKeys) {
    const row = byY.get(y);
    if (row === undefined) {
      continue;
    }
    row.sort((a, b) => a.transform[4] - b.transform[4]);
    const text = row
      .map((item) => item.str)
      .join('')
      .trim();
    if (text.length === 0) {
      continue;
    }
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
  const merged = mergeWrappedHeadings(records, items);
  const lines = merged.map((r) => r.text);
  const headings = merged.filter((r) => r.isHeading).map((r) => r.text);
  const hasHeadingItem = items.some((it) => it.height >= HEADING_H_THRESHOLD);
  return { lines, headings, hasHeadingItem };
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
