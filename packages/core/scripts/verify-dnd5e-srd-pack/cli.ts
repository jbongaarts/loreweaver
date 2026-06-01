/**
 * Manual verification command for the committed D&D 5e SRD 5.1 rules pack.
 *
 * Runs the 0m9.5 importer against the vendored SRD 5.1 PDF into a temp
 * directory, then diffs the regenerated pack against the committed canonical
 * pack at `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/`.
 *
 * Per the 0m9.6 design, the importer is treated as a one-shot construction
 * tool, not as a generator that runs on every PR. This command is the
 * operator-facing way to answer "does the committed pack still match what the
 * importer would produce today?" — invoked when importer/parser/source/schema
 * code changes, or as part of the canonical-regen PR.
 *
 * Usage:
 *
 *   npm run verify:dnd5e-srd-pack
 *
 * Exit codes:
 *   0  importer output equals the committed pack (no diff).
 *   1  importer ran and loaded but produced a diff against the committed pack.
 *   2  verification could not produce a meaningful diff — e.g. importer
 *      failure, pack-loading/validation failure, missing PDF.
 *
 * Three transitional states this command moves through:
 *
 *   - Today (loreweaver-0m9.6 just landed): exit 2. The importer's section
 *     anchors (e.g. `coreRules`'s `/^Using Ability Scores$/`) do not match
 *     the actual text extracted from the vendored SRD 5.1 PDF, so
 *     `runImporter` throws `SectionNotFoundError`. Tracked as
 *     `loreweaver-0m9.5.20`.
 *   - After 0m9.5.20 is fixed but before the canonical-regen PR: exit 1. The
 *     importer succeeds and produces the full SRD record set; the committed
 *     pack is still the 2-record seed, so the diff lists the gap.
 *   - After the canonical-regen PR replaces the seed pack with importer
 *     output: exit 0 unless importer code, parser code, the vendored PDF,
 *     the rules schemas/audit code, or the lockfile drifts.
 *
 * The script also prints the source PDF SHA-256 and (when the importer
 * succeeds) the per-kind counts so the regen PR can paste them into the PR
 * description (see `packages/core/scripts/importers/dnd5e-srd-5.1/README.md`).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  diffHasChanges,
  diffPacks,
  formatDiffReport,
  loadRulesPackFromDirectory,
  RulesPackError,
} from '../../src/internal.js';
import {
  MIN_EXPECTED_SRD_5_1_CLASSES,
  MIN_EXPECTED_SRD_5_1_CREATURES,
  MIN_EXPECTED_SRD_5_1_FEATURES,
  MIN_EXPECTED_SRD_5_1_SUBCLASSES,
  runImporter,
} from '../importers/dnd5e-srd-5.1/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');
const VENDORED_PDF = resolve(
  REPO_ROOT,
  'packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf',
);
const COMMITTED_PACK_DIR = resolve(
  REPO_ROOT,
  'packages/core/data/rules-packs/rules__dnd5e-srd-5.1',
);

async function main(): Promise<void> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'verify-dnd5e-srd-pack-'));
  try {
    console.log(`Vendored PDF: ${VENDORED_PDF}`);
    console.log(`Committed pack: ${COMMITTED_PACK_DIR}`);
    console.log(`Regenerated pack (tmp): ${tmpDir}`);
    console.log('');

    let result: Awaited<ReturnType<typeof runImporter>>;
    try {
      result = await runImporter({
        pdfPath: VENDORED_PDF,
        outDir: tmpDir,
        minCreatureCount: MIN_EXPECTED_SRD_5_1_CREATURES,
        minClassCount: MIN_EXPECTED_SRD_5_1_CLASSES,
        minSubclassCount: MIN_EXPECTED_SRD_5_1_SUBCLASSES,
        minFeatureCount: MIN_EXPECTED_SRD_5_1_FEATURES,
      });
    } catch (cause) {
      console.error(`importer failed: ${(cause as Error).message}`);
      process.exit(2);
    }

    const c = result.counts;
    console.log(`Source PDF SHA-256: ${result.sourceHash}`);
    console.log(
      `Importer counts: ${c.spells} spells, ${c.creatures} creatures, ${c.classes} classes, ${c.subclasses} subclasses, ${c.features} features, ${c.conditions} conditions, ${c.feats} feats, ${c.hazards} hazards, ${c.actions} actions, ${c.rules} rules, ${c.tables} tables, ${c.equipment} equipment, ${c.ancestries} ancestries`,
    );
    console.log('');

    let committed: ReturnType<typeof loadRulesPackFromDirectory>;
    let regenerated: ReturnType<typeof loadRulesPackFromDirectory>;
    try {
      committed = loadRulesPackFromDirectory(COMMITTED_PACK_DIR);
      regenerated = loadRulesPackFromDirectory(tmpDir);
    } catch (cause) {
      if (cause instanceof RulesPackError) {
        console.error(`pack failed validation: ${cause.message}`);
      } else {
        console.error(`failed to load pack: ${(cause as Error).message}`);
      }
      process.exit(2);
    }

    const diff = diffPacks(committed, regenerated);
    process.stdout.write(formatDiffReport(diff));

    if (diffHasChanges(diff)) {
      console.log('');
      console.log(
        'verify:dnd5e-srd-pack: committed pack differs from importer output.',
      );
      process.exit(1);
    }

    console.log('');
    console.log(
      'verify:dnd5e-srd-pack: committed pack matches importer output exactly.',
    );
    process.exit(0);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
