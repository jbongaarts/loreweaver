/**
 * End-to-end pipeline test for the D&D 5e SRD 5.1 importer.
 *
 * Generates a small fixture PDF at test time using pdfkit (so no binary
 * fixture has to live in the repo), runs the full importer (extract → parse
 * → emit), and round-trips through `loadRulesPackFromDirectory` to confirm
 * the produced files load and validate.
 *
 * The fixture PDF mimics the SRD layout closely enough to exercise the
 * spell-stat-block parser and the class-spell-list parser, but is much
 * smaller than the real SRD. The full SRD PDF is the responsibility of
 * `loreweaver-0m9.6`'s coverage tests once vendored.
 */

import { createWriteStream, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { afterEach, describe, expect, it } from 'vitest';
import { runImporter } from '../../../scripts/importers/dnd5e-srd-5.1/index.js';
import { loadRulesPackFromDirectory } from '../../../src/internal.js';

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'srd-importer-pipeline-'));
  tmpDirs.push(dir);
  return dir;
}

interface FixtureLine {
  readonly text: string;
  /** Optional explicit gap before this line. */
  readonly leadingGap?: number;
}

interface FixturePage {
  readonly lines: ReadonlyArray<string | FixtureLine>;
}

async function writeFixturePdf(
  filePath: string,
  pages: readonly FixturePage[],
): Promise<void> {
  // size: LETTER (612 x 792 pt), small margins so we fit ~50 lines per page.
  const doc = new PDFDocument({
    size: 'LETTER',
    margin: 40,
    autoFirstPage: false,
  });
  const stream = createWriteStream(filePath);
  doc.pipe(stream);
  doc.font('Helvetica').fontSize(11);

  pages.forEach((page, i) => {
    doc.addPage();
    for (const entry of page.lines) {
      if (typeof entry === 'string') {
        doc.text(entry);
      } else {
        if (entry.leadingGap !== undefined && entry.leadingGap > 0) {
          doc.moveDown(entry.leadingGap);
        }
        doc.text(entry.text);
      }
    }
    // Mark page i+1 explicitly (we don't read this; the parser uses
    // PageText.pageNumber from extract.ts, which counts pages in order).
    void i;
  });

  doc.end();
  await new Promise<void>((resolve, reject) => {
    stream.on('finish', () => resolve());
    stream.on('error', reject);
  });
}

const SPELLS_PAGE: FixturePage = {
  lines: [
    'Acid Splash',
    'Conjuration cantrip',
    'Casting Time: 1 action',
    'Range: 60 feet',
    'Components: V, S',
    'Duration: Instantaneous',
    'You hurl a bubble of acid. Choose one creature you can see within range.',
    '',
    'Magic Missile',
    '1st-level evocation',
    'Casting Time: 1 action',
    'Range: 120 feet',
    'Components: V, S',
    'Duration: Instantaneous',
    'You create three glowing darts of magical force.',
    'At Higher Levels. When you cast this spell using a spell slot of 2nd level or higher, the spell creates one more dart for each slot level above 1st.',
  ],
};

const CLASS_LISTS_PAGE: FixturePage = {
  lines: [
    'Wizard Spells',
    'Cantrips (0 Level)',
    'Acid Splash',
    '',
    '1st Level',
    'Magic Missile',
    '',
    'Sorcerer Spells',
    'Cantrips (0 Level)',
    'Acid Splash',
    '',
    '1st Level',
    'Magic Missile',
  ],
};

describe('runImporter — end-to-end against a fixture PDF', () => {
  it('extracts spells and writes a pack that loads back through loadRulesPackFromDirectory', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [SPELLS_PAGE, CLASS_LISTS_PAGE]);

    const result = await runImporter({ pdfPath, outDir });
    expect(result.counts.spells).toBe(2);
    expect(result.sourceHash).toMatch(/^[0-9a-f]{64}$/);

    const pack = loadRulesPackFromDirectory(outDir);
    expect(pack.records).toHaveLength(2);
    const keys = pack.records.map((r) => r.key).sort();
    expect(keys).toEqual(['spell:acid-splash', 'spell:magic-missile']);

    const acid = pack.records.find((r) => r.key === 'spell:acid-splash');
    expect(acid?.name).toBe('Acid Splash');
    const acidData = acid?.data as Record<string, unknown>;
    expect(acidData.level).toBe(0);
    expect(acidData.school).toBe('conjuration');
    expect(acidData.classes).toEqual(['Sorcerer', 'Wizard']);

    const mm = pack.records.find((r) => r.key === 'spell:magic-missile');
    const mmData = mm?.data as Record<string, unknown>;
    expect(mmData.level).toBe(1);
    expect(mmData.higherLevels).toMatch(/^When you cast this spell/);
  });

  it('produces a byte-identical pack across two runs over the same PDF', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outA = join(workDir, 'a');
    const outB = join(workDir, 'b');
    await writeFixturePdf(pdfPath, [SPELLS_PAGE, CLASS_LISTS_PAGE]);

    await runImporter({ pdfPath, outDir: outA });
    await runImporter({ pdfPath, outDir: outB });

    expect(readFileSync(join(outA, 'manifest.json'), 'utf8')).toBe(
      readFileSync(join(outB, 'manifest.json'), 'utf8'),
    );
    expect(readFileSync(join(outA, 'records.json'), 'utf8')).toBe(
      readFileSync(join(outB, 'records.json'), 'utf8'),
    );
  });
});
