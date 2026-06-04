/**
 * CLI for the D&D 5e SRD 5.1 importer.
 *
 * Usage:
 *
 *   npm run import:dnd5e-srd -- --pdf <path> --out <dir>
 *
 * Defaults:
 *   --pdf  packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf
 *   --out  packages/core/scripts/importers/dnd5e-srd-5.1/.generated/
 *
 * The default `--out` is a scratch path that is NOT the canonical pack
 * location. Pointing `--out` at `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/`
 * is the explicit "regenerate the canonical pack" path; it overwrites the
 * committed canonical pack. Do this when a parser/source/schema change is
 * intended to alter pack content: regenerate, review the diff with
 * `npm run audit:rules-pack` / `npm run diff:rules-pack`, update the
 * srdGeneratedPack baselines, and commit the regenerated pack so
 * `npm run verify:dnd5e-srd-pack` returns to exit 0.
 */

import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_SRD_5_1_CREATURE_NAMES,
  EXPECTED_SRD_5_1_TRAP_NAMES,
  MIN_EXPECTED_SRD_5_1_CLASSES,
  MIN_EXPECTED_SRD_5_1_FEATURES,
  MIN_EXPECTED_SRD_5_1_SUBCLASSES,
  runImporter,
} from './index.js';

interface ParsedArgs {
  readonly pdf: string;
  readonly out: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../../..');
const DEFAULT_PDF = resolve(
  REPO_ROOT,
  'packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf',
);
const DEFAULT_OUT = resolve(HERE, '.generated');

function parseArgs(argv: readonly string[]): ParsedArgs {
  let pdf = DEFAULT_PDF;
  let out = DEFAULT_OUT;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--pdf') {
      pdf = resolveArg(argv, ++i, '--pdf');
    } else if (token === '--out') {
      out = resolveArg(argv, ++i, '--out');
    } else if (token === '--help' || token === '-h') {
      printHelpAndExit(0);
    } else {
      console.error(`unknown argument: ${token}`);
      printHelpAndExit(1);
    }
  }
  return { pdf: ensureAbsolute(pdf), out: ensureAbsolute(out) };
}

function resolveArg(argv: readonly string[], i: number, flag: string): string {
  const value = argv[i];
  if (value === undefined) {
    console.error(`missing value for ${flag}`);
    printHelpAndExit(1);
  }
  return value;
}

function ensureAbsolute(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function printHelpAndExit(code: number): never {
  const text = [
    'Usage: import-dnd5e-srd [--pdf <path>] [--out <dir>]',
    '',
    `  --pdf <path>   Path to the vendored SRD 5.1 PDF (default: ${DEFAULT_PDF})`,
    `  --out <dir>    Output directory (default: ${DEFAULT_OUT})`,
    '',
    'See packages/core/scripts/importers/dnd5e-srd-5.1/README.md for context',
    'and the regeneration procedure.',
  ].join('\n');
  if (code === 0) {
    console.log(text);
  } else {
    console.error(text);
  }
  process.exit(code);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await runImporter({
    pdfPath: args.pdf,
    outDir: args.out,
    expectedCreatureNames: EXPECTED_SRD_5_1_CREATURE_NAMES,
    expectedTrapNames: EXPECTED_SRD_5_1_TRAP_NAMES,
    minClassCount: MIN_EXPECTED_SRD_5_1_CLASSES,
    minSubclassCount: MIN_EXPECTED_SRD_5_1_SUBCLASSES,
    minFeatureCount: MIN_EXPECTED_SRD_5_1_FEATURES,
  });
  const c = result.counts;
  console.log(
    `Imported ${c.spells} spells, ${c.creatures} creatures, ${c.classes} classes, ${c.subclasses} subclasses, ${c.features} features, ${c.conditions} conditions, ${c.feats} feats, ${c.hazards} hazards, ${c.traps} traps, ${c.actions} actions, ${c.rules} rules, ${c.tables} tables, ${c.equipment} equipment, and ${c.ancestries} ancestries.`,
  );
  console.log(`Source PDF SHA-256: ${result.sourceHash}`);
  console.log(`Output written to: ${result.outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
