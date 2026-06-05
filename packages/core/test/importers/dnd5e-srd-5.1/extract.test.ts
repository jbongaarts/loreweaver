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
 * and (e) the document-level fallback that leaves `headingLineIndexes`
 * undefined for uniform-font fixtures so existing tests still see all lines.
 */

import { createWriteStream, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { afterEach, describe, expect, it } from 'vitest';
import { extractPdfText } from '../../../scripts/importers/dnd5e-srd-5.1/extract.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function headingTexts(page: PageText): readonly string[] {
  const idx = page.headingLineIndexes;
  if (idx === undefined) return [];
  return idx.map((i) => page.lines[i]);
}

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
    expect(pages[0].headingLineIndexes).toBeDefined();
    expect(headingTexts(pages[0])).toContain('Using Ability Scores');
    expect(pages[0].lines).toContain('Using Ability Scores');
    // The merge consumed the individual rows, so they should not also appear
    // as separate lines.
    expect(pages[0].lines).not.toContain('Using Ability');
    expect(pages[0].lines).not.toContain('Scores');
    // Indexes resolve through `lines` — sanity check the pointer.
    const headingIdxs = pages[0].headingLineIndexes ?? [];
    expect(headingIdxs.length).toBeGreaterThan(0);
    expect(headingIdxs.map((i) => pages[0].lines[i])).toContain(
      'Using Ability Scores',
    );
  });

  it('joins a three-line chapter title (Appendix PH-B style)', async () => {
    const pages = await extractFromOps([
      { text: 'Appendix PH-B:', size: 26, x: 60, y: 60 },
      { text: 'Fantasy-Historical', size: 26, x: 60, y: 100 },
      { text: 'Pantheons', size: 26, x: 60, y: 140 },
      { text: 'Body prose paragraph.', size: 11, x: 60, y: 200 },
    ]);
    expect(headingTexts(pages[0])).toContain(
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
    expect(headingTexts(pages[0])).toContain('Using Ability Scores');
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
    const headings = headingTexts(pages[0]);
    expect(headings).toContain('Heading One');
    expect(headings).toContain('Heading Two');
    expect(headings).not.toContain('Heading One Heading Two');
  });

  it('does not fold body prose into a heading', async () => {
    const pages = await extractFromOps([
      { text: 'Some Heading', size: 26, x: 60, y: 60 },
      { text: 'body paragraph one', size: 11, x: 60, y: 100 },
      { text: 'body paragraph two', size: 11, x: 60, y: 120 },
    ]);
    expect(pages[0].lines).toContain('Some Heading');
    expect(pages[0].lines).toContain('body paragraph one');
    // The heading line index should resolve to 'Some Heading'; the body
    // line index must not be present in headingLineIndexes.
    const headings = headingTexts(pages[0]);
    expect(headings).toContain('Some Heading');
    expect(headings).not.toContain('body paragraph one');
  });

  it('does not merge subsection-level titles (only chapter-size headings wrap in SRD 5.1)', async () => {
    // h=18 subsection titles in the real SRD don't wrap; making them mergeable
    // would risk gluing legitimately distinct subsection titles together.
    const pages = await extractFromOps([
      { text: 'Subsection One', size: 18, x: 60, y: 60 },
      { text: 'Subsection Two', size: 18, x: 60, y: 100 },
    ]);
    const headings = headingTexts(pages[0]);
    expect(headings).toContain('Subsection One');
    expect(headings).toContain('Subsection Two');
    expect(headings).not.toContain('Subsection One Subsection Two');
  });

  it('leaves `headingLineIndexes` undefined when the document has no heading-class items (uniform-font fixture)', async () => {
    // Every line is body-size. The extractor should not pretend the page
    // has a `headingLineIndexes` array (which would be empty) — leaving
    // it undefined signals "no font info available" to `sliceSection`,
    // which then falls back to line matching even for anchors with
    // `matchHeadings: true`.
    const pages = await extractFromOps([
      { text: 'Equipment', size: 11 },
      { text: 'Some body prose.', size: 11 },
    ]);
    for (const page of pages) {
      expect(page.headingLineIndexes).toBeUndefined();
    }
  });

  it('emits two-column body pages column-by-column, not row-interleaved', async () => {
    // Mimics the SRD spell-descriptions layout (page 114 in the real PDF):
    // two columns of stat blocks where pdfjs returns items y-interleaved
    // across columns. The extractor must produce a left-column-then-right-
    // column reading order so a spell's name, level marker, and metadata
    // stay contiguous instead of interleaving with the adjacent column's
    // spell.
    //
    // Each column carries items at multiple x positions (left edge plus a
    // small wrap indent) so the distinct-x diversity check in
    // partitionItemsByColumn accepts the cut as a real page-column
    // gutter rather than an intra-column label/value tab stop.
    const pages = await extractFromOps([
      // Left column spell.
      { text: 'Acid Arrow', size: 11, x: 60, y: 200 },
      { text: '2nd-level evocation', size: 11, x: 60, y: 220 },
      { text: 'Casting Time: 1 action', size: 11, x: 60, y: 240 },
      { text: 'wrap continuation', size: 11, x: 70, y: 260 },
      // Right column spell at roughly the same y as the left column, with
      // a small offset that lands it in a different y-bucket.
      { text: 'Alarm', size: 11, x: 330, y: 204 },
      { text: '1st-level abjuration', size: 11, x: 330, y: 224 },
      { text: 'Casting Time: 1 minute', size: 11, x: 330, y: 244 },
      { text: 'wrap continuation', size: 11, x: 340, y: 264 },
    ]);
    const flat = pages[0].lines;
    // Left column lines come first, in their own reading order.
    const acidArrowIdx = flat.indexOf('Acid Arrow');
    const acidArrowMarkerIdx = flat.indexOf('2nd-level evocation');
    const alarmIdx = flat.indexOf('Alarm');
    expect(acidArrowIdx).toBeGreaterThanOrEqual(0);
    expect(alarmIdx).toBeGreaterThan(acidArrowIdx);
    // Critically: the left column's marker line must precede the right
    // column's name (the pre-fix behavior interleaved them, so "Alarm"
    // landed between "Acid Arrow" and "2nd-level evocation").
    expect(acidArrowMarkerIdx).toBeGreaterThan(acidArrowIdx);
    expect(acidArrowMarkerIdx).toBeLessThan(alarmIdx);
  });

  it('keeps a repeated label/value layout as a single column even when the label/value x-gap exceeds the column-gap threshold', async () => {
    // The regression this guards: a stat-block-style layout that prints
    // labels at one x and values at another x for many rows. The label/
    // value x-gap can easily exceed COLUMN_GAP_THRESHOLD (here 60→130 =
    // 70pt > 50pt), but it's an intra-column tab stop, not a page-column
    // gutter. partitionItemsByColumn must keep the rows intact instead of
    // emitting all labels first and then all values.
    const pages = await extractFromOps([
      { text: 'Armor Class', size: 11, x: 60, y: 100 },
      { text: '17 (natural armor)', size: 11, x: 130, y: 100 },
      { text: 'Hit Points', size: 11, x: 60, y: 115 },
      { text: '178', size: 11, x: 130, y: 115 },
      { text: 'Speed', size: 11, x: 60, y: 130 },
      { text: '40 ft.', size: 11, x: 130, y: 130 },
    ]);
    const lines = pages[0].lines;
    expect(lines).toContain('Armor Class 17 (natural armor)');
    expect(lines).toContain('Hit Points 178');
    expect(lines).toContain('Speed 40 ft.');
    // Source order is preserved (no all-labels-then-all-values reorder).
    const acIdx = lines.indexOf('Armor Class 17 (natural armor)');
    const hpIdx = lines.indexOf('Hit Points 178');
    const speedIdx = lines.indexOf('Speed 40 ft.');
    expect(hpIdx).toBeGreaterThan(acIdx);
    expect(speedIdx).toBeGreaterThan(hpIdx);
    // And no label-cluster line slipped through (the pre-fix bug would
    // have grouped "Armor Class" / "Hit Points" / "Speed" into a left
    // "column" emitted before the values).
    expect(lines).not.toContain('Armor Class');
    expect(lines).not.toContain('Hit Points');
    expect(lines).not.toContain('Speed');
  });

  it('separates two flush-left single-x columns across a wide page gutter (spell-list layout)', async () => {
    // Regression for loreweaver-xbh. The SRD 5.1 "Spell Lists" pages print
    // each class's spell names flush-left in two columns with NO wrap indent,
    // so each real column draws from a single x. The left column sits at
    // x≈58 and the right at x≈329 — a ≈271pt gutter. The distinct-x guard
    // (which rejects intra-column label/value tab stops) would reject this
    // cut because each side has only one distinct x, collapsing both columns
    // into one y-interleaved flow: the opposite column's "Ranger Spells"
    // header dropped into the middle of Sorcerer's cantrip list and every
    // cantrip after the first was lost from the class index. The wide-gutter
    // escape hatch accepts the cut so each column stays intact.
    const pages = await extractFromOps([
      // Right column (Sorcerer), interleaved in y with the left column.
      { text: 'Sorcerer Spells', size: 11, x: 330, y: 200 },
      { text: 'Cantrips (0 Level)', size: 11, x: 330, y: 220 },
      { text: 'Acid Splash', size: 11, x: 330, y: 240 },
      { text: 'Fire Bolt', size: 11, x: 330, y: 260 },
      // Left column (Ranger) — single x, baselines between the right column's.
      { text: 'Ranger Spells', size: 11, x: 60, y: 210 },
      { text: 'Alarm', size: 11, x: 60, y: 230 },
      { text: 'Hunters Mark', size: 11, x: 60, y: 250 },
    ]);
    const lines = pages[0].lines;
    // The whole left column must precede the whole right column — the bug
    // symptom was the two columns alternating line-by-line so "Ranger
    // Spells" landed between "Acid Splash" and "Fire Bolt".
    const lastLeft = Math.max(
      lines.indexOf('Ranger Spells'),
      lines.indexOf('Alarm'),
      lines.indexOf('Hunters Mark'),
    );
    const firstRight = Math.min(
      lines.indexOf('Sorcerer Spells'),
      lines.indexOf('Cantrips (0 Level)'),
      lines.indexOf('Acid Splash'),
      lines.indexOf('Fire Bolt'),
    );
    expect(firstRight).toBeGreaterThanOrEqual(0);
    expect(lastLeft).toBeLessThan(firstRight);
    // And the right column's own reading order is intact and contiguous.
    expect(lines.indexOf('Fire Bolt')).toBe(lines.indexOf('Acid Splash') + 1);
  });

  it('picks the real page gutter even when a far-right outlier opens a larger x-gap that fails the per-side guards', async () => {
    // Regression for loreweaver-w8h. Real SRD 5.1 page 268 has the standard
    // two-column body (gutter at x≈290) PLUS one stray item out at x≈540 —
    // the absolute-largest x-gap is between the right-column body (x≈445)
    // and that outlier (~94pt), bigger than the real gutter (~78pt). The
    // older partitioner picked the absolute-largest gap, the right side
    // failed the MIN_ITEMS guard, and the page fell back to unpartitioned
    // y-bucketing — interleaving the two columns line-by-line and dropping
    // creature stat blocks. The fix scans every above-threshold gap and
    // keeps only valid cuts, so the page gutter wins.
    const pages = await extractFromOps([
      // Left column.
      { text: 'left col line 1', size: 11, x: 60, y: 200 },
      { text: 'left col line 2', size: 11, x: 60, y: 220 },
      { text: 'left wrap', size: 11, x: 70, y: 240 },
      // Right column.
      { text: 'right col line 1', size: 11, x: 330, y: 204 },
      { text: 'right col line 2', size: 11, x: 330, y: 224 },
      { text: 'right wrap', size: 11, x: 340, y: 244 },
      // Stray far-right outlier — opens a 100pt+ gap that would have
      // captured the partition under the old algorithm.
      { text: 'outlier', size: 11, x: 540, y: 260 },
    ]);
    const lines = pages[0].lines;
    const leftIdx = lines.indexOf('left col line 1');
    const rightIdx = lines.indexOf('right col line 1');
    expect(leftIdx).toBeGreaterThanOrEqual(0);
    expect(rightIdx).toBeGreaterThanOrEqual(0);
    // The whole left column must precede the right column — the bug
    // symptom was alternating left/right lines from the y-buckets.
    expect(lines.indexOf('left col line 2')).toBeLessThan(rightIdx);
    expect(lines.indexOf('left wrap')).toBeLessThan(rightIdx);
    // The outlier is bucketed with the right column (it's on its side of
    // the gutter cut) and follows it.
    expect(lines.indexOf('outlier')).toBeGreaterThan(rightIdx);
  });

  it('picks the real page gutter when two far-right outliers satisfy the minimum guards', async () => {
    // Regression for loreweaver-ecr.4. SRD p236 has the real Magic Items
    // two-column gutter at x~274->329, plus two far-right words in the right
    // column at x~503/527. The far-right island opens a wider x-gap and has
    // two distinct x positions, so the old "largest valid gap wins" rule chose
    // it and left the real columns row-interleaved.
    const pages = await extractFromOps([
      // Left column.
      { text: 'left col line 1', size: 11, x: 60, y: 200 },
      { text: 'left col line 2', size: 11, x: 60, y: 220 },
      { text: 'left wrap', size: 11, x: 70, y: 240 },
      // Right column.
      { text: 'right col line 1', size: 11, x: 330, y: 204 },
      { text: 'right col line 2', size: 11, x: 330, y: 224 },
      { text: 'right wrap', size: 11, x: 340, y: 244 },
      // Tiny far-right island inside the right column.
      { text: 'far', size: 11, x: 505, y: 260 },
      { text: 'outlier', size: 11, x: 530, y: 260 },
    ]);
    const lines = pages[0].lines;
    const leftIdx = lines.indexOf('left col line 1');
    const rightIdx = lines.indexOf('right col line 1');
    expect(leftIdx).toBeGreaterThanOrEqual(0);
    expect(rightIdx).toBeGreaterThanOrEqual(0);
    expect(lines.indexOf('left col line 2')).toBeLessThan(rightIdx);
    expect(lines.indexOf('left wrap')).toBeLessThan(rightIdx);
    expect(lines.indexOf('far outlier')).toBeGreaterThan(rightIdx);
  });

  it('reassigns repeated left-column fragments before a denser right margin', async () => {
    // Regression for PR #150 review. SRD p238 has two left-column phrase
    // fragments past x=230 ("telekinesis" and "spell from") after an internal
    // left-column cut sweeps them into the right partition. Count=2 was enough
    // for the straggler repair to mistake that x for the right column margin,
    // so "spell from" stayed separated from "wish" and Ring of Three Wishes
    // lost the phrase "spell from it".
    const pages = await extractFromOps([
      { text: 'left intro', size: 11, x: 60, y: 200 },
      { text: 'cast the', size: 11, x: 60, y: 220 },
      { text: 'telekinesis', size: 11, x: 238, y: 220 },
      { text: 'cast the', size: 11, x: 60, y: 260 },
      { text: 'wish', size: 11, x: 211, y: 260 },
      { text: 'spell from', size: 11, x: 238, y: 260 },
      { text: 'it', size: 11, x: 60, y: 280 },
      { text: 'right column one', size: 11, x: 330, y: 210 },
      { text: 'right column two', size: 11, x: 330, y: 230 },
      { text: 'right column three', size: 11, x: 330, y: 250 },
    ]);
    const lines = pages[0].lines;

    expect(lines).toContain('cast the telekinesis');
    expect(lines).toContain('cast the wish spell from');
    expect(lines).not.toContain('telekinesis');
    expect(lines).not.toContain('spell from');
    expect(lines.indexOf('cast the wish spell from')).toBeLessThan(
      lines.indexOf('right column one'),
    );
  });

  it('keeps sparse table value columns on the right side of the cut', async () => {
    // Regression for the armor table on SRD p63. Its "Strength" column has only
    // two starts on the page (the header and the Padded row dash), while nearby
    // right-column prose has a denser margin. The straggler repair must not move
    // the Strength dash back into the left table row, or the equipment parser
    // sees "Padded 5 gp 11 + Dex modifier -" and drops the Padded armor record.
    const pages = await extractFromOps([
      { text: 'Armor', size: 11, x: 60, y: 200 },
      { text: 'Cost', size: 11, x: 151, y: 200 },
      { text: 'Armor Class (AC)', size: 11, x: 189, y: 200 },
      { text: 'Strength', size: 11, x: 294, y: 200 },
      { text: 'Stealth', size: 11, x: 337, y: 200 },
      { text: 'Weight', size: 11, x: 420, y: 200 },
      { text: 'Padded', size: 11, x: 66, y: 220 },
      { text: '5 gp', size: 11, x: 152, y: 220 },
      { text: '11 + Dex modifier', size: 11, x: 189, y: 220 },
      { text: '-', size: 11, x: 294, y: 220 },
      { text: 'Disadvantage', size: 11, x: 337, y: 220 },
      { text: '8 lb.', size: 11, x: 420, y: 220 },
      { text: 'right column one', size: 11, x: 330, y: 240 },
      { text: 'right column two', size: 11, x: 330, y: 260 },
      { text: 'right column three', size: 11, x: 330, y: 280 },
    ]);
    const lines = pages[0].lines;

    expect(lines).toContain('Padded 5 gp 11 + Dex modifier');
    expect(lines).toContain('- Disadvantage 8 lb.');
    expect(lines).not.toContain('Padded 5 gp 11 + Dex modifier -');
  });

  it('reassigns a justified left-column last word that the widest gap swept across the gutter', async () => {
    // Regression for loreweaver-7ok. The SRD 5.1 body justifies paragraphs, so
    // each paragraph's last word is pushed flush to its column's right edge. On
    // page 193 (end of the "Wish" spell) the left column's right-aligned last
    // word "wish" sits at x≈259, just left of the page gutter (x≈329). The
    // WIDEST valid x-gap on that page is an internal left-column gap (≈80pt)
    // whose midpoint falls LEFT of "wish", so the largest-gap cut sweeps "wish"
    // into the right column, where it buckets by y between "Word of Recall"'s
    // lines and corrupts that spell's body. The gutter-straggler correction
    // keys off line-start density — the real right margin has many line-starts
    // while the swept word is a lone count-1 item — and moves "wish" back to
    // the left column, where it rejoins its own paragraph line.
    //
    // Layout below reproduces that shape: an internal left gap (160→258 = 98pt)
    // wider than the gutter (258→330 = 72pt), with "wish" at x=258 sharing the
    // baseline of its left-column line, and a dense three-line right column.
    const pages = await extractFromOps([
      { text: 'first left line', size: 11, x: 60, y: 200 },
      // "for example a" + "wish" are one justified line: same baseline, with
      // the last word flush to the column's right edge near the gutter.
      { text: 'for example a', size: 11, x: 60, y: 220 },
      { text: 'wish', size: 11, x: 258, y: 220 },
      // A deeper-indent left-column line so the left side clears the distinct-x
      // diversity guard and the 160→258 gap is the page's widest.
      { text: 'deep indent line', size: 11, x: 160, y: 240 },
      // Dense right column (the true gutter's right margin: three line-starts).
      { text: 'right column one', size: 11, x: 330, y: 210 },
      { text: 'right column two', size: 11, x: 330, y: 230 },
      { text: 'right column three', size: 11, x: 330, y: 250 },
    ]);
    const lines = pages[0].lines;
    // "wish" rejoined its left-column line; it never appears as its own line.
    expect(lines).toContain('for example a wish');
    expect(lines).not.toContain('wish');
    // The right column is intact and contiguous — the pre-fix bug dropped
    // "wish" between "right column one" and "right column two".
    const r1 = lines.indexOf('right column one');
    const r2 = lines.indexOf('right column two');
    const r3 = lines.indexOf('right column three');
    expect(r1).toBeGreaterThanOrEqual(0);
    expect(r2).toBe(r1 + 1);
    expect(r3).toBe(r2 + 1);
    // The whole left column (including the rejoined word) precedes the right.
    expect(lines.indexOf('for example a wish')).toBeLessThan(r1);
  });

  it('leaves a clean two-column page untouched (no straggler to reassign)', async () => {
    // The correction must be a no-op when the right column has no item left of
    // its dense margin: a normal two-column body page keeps its split exactly.
    const pages = await extractFromOps([
      { text: 'left body line', size: 11, x: 60, y: 200 },
      { text: 'left wrap indent', size: 11, x: 70, y: 220 },
      { text: 'right body line', size: 11, x: 330, y: 204 },
      { text: 'right wrap indent', size: 11, x: 340, y: 224 },
    ]);
    const lines = pages[0].lines;
    expect(lines).toContain('left body line');
    expect(lines).toContain('right body line');
    // Left column still precedes the right; nothing was shuffled.
    expect(lines.indexOf('left wrap indent')).toBeLessThan(
      lines.indexOf('right body line'),
    );
  });

  it('separates items at identical y but in different columns', async () => {
    // Critical: SRD page 299 has the previous monster's wrap line in the
    // left column at the SAME y baseline as the next monster's "Speed"
    // line in the right column. A row-bucketing pass that didn't separate
    // items by column first would join those into one line ("… one
    // Speed 40 ft., …"), erasing the Speed line and causing parseCreatures
    // to throw "missing a Speed line".
    //
    // Each column carries items at more than one x position so the
    // distinct-x diversity guard accepts the cut as a real page-column
    // gutter (not a label/value tab).
    const pages = await extractFromOps([
      { text: 'left-col text', size: 11, x: 60, y: 200 },
      { text: 'left col body line', size: 11, x: 60, y: 220 },
      { text: 'wrap indent', size: 11, x: 70, y: 240 },
      { text: 'right-col Speed', size: 11, x: 330, y: 200 },
      { text: 'right col body line', size: 11, x: 330, y: 220 },
      { text: 'wrap indent', size: 11, x: 340, y: 240 },
    ]);
    expect(pages[0].lines).toContain('left-col text');
    expect(pages[0].lines).toContain('right-col Speed');
    // The diagnostic regression: the two strings must never appear in a
    // single concatenated line.
    for (const line of pages[0].lines) {
      expect(line).not.toMatch(/left-col text.*right-col Speed/);
    }
  });

  it('inserts a space between same-baseline items separated by a visual gap', async () => {
    // SRD stat-block label/value rows render as two pdfjs items at the
    // same y with no whitespace inside either `str` (the bold-to-regular
    // font switch breaks the run). The extractor must inject a space so
    // downstream regexes like `^Armor Class\s+(\d+)` match.
    const pages = await extractFromOps([
      { text: 'Armor Class', size: 11, x: 60, y: 100 },
      { text: '17 (natural armor)', size: 11, x: 130, y: 100 },
    ]);
    expect(pages[0].lines).toContain('Armor Class 17 (natural armor)');
  });

  it('drops the persistent SRD footer band so it does not bleed into spell metadata', async () => {
    // The SRD 5.1 page footer ("System Reference Document 5.1" + page #)
    // renders at PDF-native y ≈ 31.9 on every body page. Pre-fix, with
    // column-aware emission, the footer ended up appended after the
    // bottom of the right column and parseSpells consumed it as a
    // continuation of the previous spell's Components field.
    //
    // pdfkit measures y from the top of the page; PDFs measure y from
    // the bottom. To place a footer at PDF-native y ≈ 30, render at
    // pdfkit y = pageHeight − ~40, i.e. y ≈ 755 on a LETTER page.
    const pages = await extractFromOps([
      { text: 'Body line', size: 11, x: 60, y: 200 },
      { text: 'System Reference Document 5.1', size: 9, x: 380, y: 755 },
      { text: '189', size: 9, x: 560, y: 755 },
    ]);
    expect(pages[0].lines).toContain('Body line');
    for (const line of pages[0].lines) {
      expect(line).not.toContain('System Reference Document 5.1');
      expect(line).not.toBe('189');
    }
  });

  it('leaves single-column pages in y-descending order', async () => {
    // All items at the same x cluster — no column split, so the original
    // y-descending order is preserved.
    const pages = await extractFromOps([
      { text: 'Line A', size: 11, x: 60, y: 100 },
      { text: 'Line B', size: 11, x: 60, y: 120 },
      { text: 'Line C', size: 11, x: 60, y: 140 },
    ]);
    // Higher y = top of page first.
    expect(pages[0].lines).toEqual(['Line A', 'Line B', 'Line C']);
  });

  it('recomputes headingLineIndexes after column reordering', async () => {
    // Two columns; the left column has a heading at the top. After the
    // column-by-column emit, the heading still resolves through
    // headingLineIndexes — the indexes must be recomputed against the
    // re-ordered lines, not against the pre-partition order.
    //
    // Each column carries items at more than one x so the distinct-x
    // diversity guard accepts the column split.
    const pages = await extractFromOps([
      { text: 'Left Heading', size: 26, x: 60, y: 60 },
      { text: 'left body line', size: 11, x: 60, y: 120 },
      { text: 'left wrap indent', size: 11, x: 70, y: 140 },
      { text: 'right body line A', size: 11, x: 330, y: 100 },
      { text: 'right body line B', size: 11, x: 330, y: 140 },
      { text: 'right wrap indent', size: 11, x: 340, y: 160 },
    ]);
    const idxs = pages[0].headingLineIndexes ?? [];
    expect(idxs.length).toBe(1);
    expect(pages[0].lines[idxs[0]]).toBe('Left Heading');
  });

  it('headingLineIndexes point at heading line POSITIONS, not just heading TEXT', async () => {
    // Two lines on the page both have text "Equipment" — one heading-sized,
    // one body-sized. The extractor must mark only the heading-sized
    // occurrence's INDEX, even though their trimmed text is identical.
    // This is what `sliceSection` relies on to skip body lines that
    // happen to spell the same text as a chapter title.
    const pages = await extractFromOps([
      { text: 'Equipment', size: 26, x: 60, y: 60 },
      { text: 'Equipment', size: 11, x: 60, y: 120 },
    ]);
    const page = pages[0];
    const idxs = page.headingLineIndexes ?? [];
    expect(idxs.length).toBe(1);
    // The heading is rendered first (highest y in PDF space = top of
    // page = first line in reading order), so it lands at line 0.
    expect(idxs[0]).toBe(0);
    expect(page.lines[0]).toBe('Equipment');
    expect(page.lines[1]).toBe('Equipment');
  });
});
