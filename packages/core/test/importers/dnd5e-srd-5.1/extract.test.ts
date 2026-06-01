/**
 * Tests for the PDF text extractor's heading-aware behavior
 * (loreweaver-0m9.5.20).
 *
 * The SRD 5.1 PDF renders chapter titles at a much larger font height than
 * body prose; narrow chapter titles wrap onto two or three visual rows
 * ("Using Ability" / "Scores", "Appendix PH-A:" / "Conditions") in the
 * left sidebar, interleaved by a side-by-side table on the right that lives
 * between their y-coordinates. The extractor's heading-merge pass is what
 * makes a single `^Using Ability Scores$` anchor line out of those two
 * pdfjs-extracted rows.
 *
 * These tests build fixture PDFs with pdfkit at multiple font sizes so we
 * can exercise: (a) the merge of an adjacent multi-line chapter title in a
 * single column, (b) the merge of a multi-line chapter title even when a
 * different-column item interleaves in y-order, (c) leaving body prose
 * alone, (d) leaving subsection titles alone (they don't wrap in SRD 5.1),
 * and (e) the document-level fallback that leaves `headings` undefined for
 * uniform-font fixtures so existing tests still see all lines.
 */

import { createWriteStream, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { afterEach, describe, expect, it } from 'vitest';
import { extractPdfText } from '../../../scripts/importers/dnd5e-srd-5.1/extract.js';

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'srd-extract-test-'));
  tmpDirs.push(dir);
  return dir;
}

interface TextOp {
  readonly text: string;
  readonly size: number;
  readonly x?: number;
  readonly y?: number;
}

async function writePdf(
  filePath: string,
  ops: readonly TextOp[],
): Promise<void> {
  const doc = new PDFDocument({
    size: 'LETTER',
    margin: 40,
    autoFirstPage: true,
  });
  const stream = createWriteStream(filePath);
  doc.pipe(stream);
  for (const op of ops) {
    doc.font('Helvetica').fontSize(op.size);
    if (op.x !== undefined && op.y !== undefined) {
      doc.text(op.text, op.x, op.y, { lineBreak: false });
    } else {
      doc.text(op.text);
    }
  }
  doc.end();
  await new Promise<void>((resolve, reject) => {
    stream.on('finish', () => resolve());
    stream.on('error', reject);
  });
}

async function extractFromOps(ops: readonly TextOp[]) {
  const dir = makeTmpDir();
  const pdfPath = join(dir, 'fixture.pdf');
  await writePdf(pdfPath, ops);
  const buf = readFileSync(pdfPath);
  return extractPdfText(new Uint8Array(buf));
}

describe('extractPdfText — heading merge', () => {
  it('joins a multi-line chapter title rendered in the same column', async () => {
    const pages = await extractFromOps([
      // Heading lines at large font (h ≥ 20) at x=60.
      { text: 'Using Ability', size: 26, x: 60, y: 60 },
      { text: 'Scores', size: 26, x: 60, y: 100 },
      // Body line at small font on the same column further down.
      { text: 'Six abilities provide a description.', size: 11, x: 60, y: 160 },
    ]);
    const headings = pages[0].headings;
    expect(headings).toBeDefined();
    expect(headings).toContain('Using Ability Scores');
    expect(pages[0].lines).toContain('Using Ability Scores');
    // The merge consumed the individual rows, so they should not also appear
    // as separate lines.
    expect(pages[0].lines).not.toContain('Using Ability');
    expect(pages[0].lines).not.toContain('Scores');
  });

  it('joins a three-line chapter title (Appendix PH-B style)', async () => {
    const pages = await extractFromOps([
      { text: 'Appendix PH-B:', size: 26, x: 60, y: 60 },
      { text: 'Fantasy-Historical', size: 26, x: 60, y: 100 },
      { text: 'Pantheons', size: 26, x: 60, y: 140 },
      { text: 'Body prose paragraph.', size: 11, x: 60, y: 200 },
    ]);
    expect(pages[0].headings).toContain(
      'Appendix PH-B: Fantasy-Historical Pantheons',
    );
  });

  it('merges across a side-column table that interleaves in y-order', async () => {
    // Mimic the SRD p76 layout: chapter title in the left column with a
    // table on the right column whose rows are y-interleaved between the
    // chapter title's wrapped lines. The merge must look past those.
    const pages = await extractFromOps([
      { text: 'Using Ability', size: 26, x: 60, y: 60 },
      { text: '12–13 +1', size: 9, x: 400, y: 70 },
      { text: '14–15 +2', size: 9, x: 400, y: 85 },
      { text: 'Scores', size: 26, x: 60, y: 110 },
      { text: '16–17 +3', size: 9, x: 400, y: 125 },
      { text: 'Body line.', size: 11, x: 60, y: 160 },
    ]);
    expect(pages[0].headings).toContain('Using Ability Scores');
  });

  it('does not merge a heading line across body prose in the SAME column', async () => {
    // If a body paragraph appears in the column between two heading rows,
    // they MUST NOT merge — otherwise we'd glue distant chapter titles
    // together as if they were a wrapped pair.
    const pages = await extractFromOps([
      { text: 'Heading One', size: 26, x: 60, y: 60 },
      { text: 'Some intervening prose.', size: 11, x: 60, y: 90 },
      { text: 'Heading Two', size: 26, x: 60, y: 130 },
    ]);
    expect(pages[0].headings).toContain('Heading One');
    expect(pages[0].headings).toContain('Heading Two');
    expect(pages[0].headings).not.toContain('Heading One Heading Two');
  });

  it('does not fold body prose into a heading', async () => {
    const pages = await extractFromOps([
      { text: 'Some Heading', size: 26, x: 60, y: 60 },
      { text: 'body paragraph one', size: 11, x: 60, y: 100 },
      { text: 'body paragraph two', size: 11, x: 60, y: 120 },
    ]);
    expect(pages[0].lines).toContain('Some Heading');
    expect(pages[0].lines).toContain('body paragraph one');
    // The heading should be in `headings`; the body must not be.
    expect(pages[0].headings).toContain('Some Heading');
    expect(pages[0].headings).not.toContain('body paragraph one');
  });

  it('does not merge subsection-level titles (only chapter-size headings wrap in SRD 5.1)', async () => {
    // h=18 subsection titles in the real SRD don't wrap; making them mergeable
    // would risk gluing legitimately distinct subsection titles together.
    const pages = await extractFromOps([
      { text: 'Subsection One', size: 18, x: 60, y: 60 },
      { text: 'Subsection Two', size: 18, x: 60, y: 100 },
    ]);
    expect(pages[0].headings).toContain('Subsection One');
    expect(pages[0].headings).toContain('Subsection Two');
    expect(pages[0].headings).not.toContain('Subsection One Subsection Two');
  });

  it('leaves `headings` undefined when the document has no heading-class items (uniform-font fixture)', async () => {
    // Every line is body-size. The extractor should not pretend the page
    // has a `headings` array (which would be empty) — leaving it undefined
    // signals "no font info available" to `sliceSection`, which then falls
    // back to line matching even for anchors with `matchHeadings: true`.
    const pages = await extractFromOps([
      { text: 'Equipment', size: 11 },
      { text: 'Some body prose.', size: 11 },
    ]);
    for (const page of pages) {
      expect(page.headings).toBeUndefined();
    }
  });
});
