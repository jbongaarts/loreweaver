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
}
interface PdfTextContent {
  readonly items: readonly unknown[];
}

/** Round y to this many decimal places when grouping items into lines. */
const Y_GROUP_PRECISION = 1;

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
    const pages: PageText[] = [];
    for (let i = start; i <= end; i++) {
      const page = await pdf.getPage(i);
      try {
        const content = await page.getTextContent();
        pages.push({
          pageNumber: i,
          lines: textContentToLines(content),
        });
      } finally {
        page.cleanup();
      }
    }
    return pages;
  } finally {
    await pdf.cleanup();
    await pdf.destroy();
  }
}

function textContentToLines(content: PdfTextContent): readonly string[] {
  // pdfjs gives mixed items. Only text items carry a string we want.
  const items: PdfTextItem[] = content.items.filter(
    (item): item is PdfTextItem =>
      typeof item === 'object' &&
      item !== null &&
      'str' in item &&
      'transform' in item,
  );
  if (items.length === 0) {
    return [];
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
  const lines: string[] = [];
  for (const y of yKeys) {
    const row = byY.get(y);
    if (row === undefined) {
      continue;
    }
    row.sort((a, b) => a.transform[4] - b.transform[4]);
    const joined = row
      .map((item) => item.str)
      .join('')
      .trim();
    if (joined.length > 0) {
      lines.push(joined);
    }
  }
  return lines;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
