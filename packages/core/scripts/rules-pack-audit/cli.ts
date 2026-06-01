/**
 * CLI for generic rules-pack audit and diff.
 *
 * Usage:
 *
 *   npm run audit:rules-pack -- audit <packDir>
 *   npm run diff:rules-pack  -- diff  <baselineDir> <candidateDir>
 *
 * Common flags:
 *   --json              Print the JSON form instead of the human-readable text.
 *   --strict            Exit nonzero when findings exist (audit) or any change
 *                       is detected (diff). Use for CI gating.
 *
 * Both subcommands load packs through `loadRulesPackFromDirectory`, so the
 * baseline `validateRulesPack` invariants are enforced before any audit or
 * diff runs. A pack that fails validation reports the validation error to
 * stderr and exits with code 2 — this is distinct from `--strict` findings,
 * which exit with code 1.
 *
 * This tool is system-agnostic. It does NOT vendor source artifacts, run
 * importers, or know anything about D&D / Pathfinder content; it operates on
 * the generic `RulesPack` shape produced by any importer.
 */

import { isAbsolute, resolve } from 'node:path';
import {
  auditHasFindings,
  auditPack,
  diffHasChanges,
  diffPacks,
  formatAuditReport,
  formatDiffReport,
  loadRulesPackFromDirectory,
  RulesPackError,
} from '../../src/internal.js';

interface SharedOptions {
  readonly json: boolean;
  readonly strict: boolean;
}

interface AuditCommand {
  readonly kind: 'audit';
  readonly packDir: string;
  readonly options: SharedOptions;
}

interface DiffCommand {
  readonly kind: 'diff';
  readonly beforeDir: string;
  readonly afterDir: string;
  readonly options: SharedOptions;
}

type ParsedCommand = AuditCommand | DiffCommand;

function ensureAbsolute(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function parseArgs(argv: readonly string[]): ParsedCommand {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printHelpAndExit(argv.length === 0 ? 1 : 0);
  }
  const subcommand = argv[0];
  const rest = argv.slice(1);
  if (subcommand === 'audit') {
    return parseAuditArgs(rest);
  }
  if (subcommand === 'diff') {
    return parseDiffArgs(rest);
  }
  console.error(`unknown subcommand: ${subcommand}`);
  printHelpAndExit(1);
}

interface PartitionedArgs {
  readonly positional: readonly string[];
  readonly options: SharedOptions;
}

function partitionArgs(argv: readonly string[]): PartitionedArgs {
  let json = false;
  let strict = false;
  const positional: string[] = [];
  for (const token of argv) {
    if (token === '--json') {
      json = true;
    } else if (token === '--strict') {
      strict = true;
    } else if (token === '--help' || token === '-h') {
      printHelpAndExit(0);
    } else if (token.startsWith('--')) {
      console.error(`unknown flag: ${token}`);
      printHelpAndExit(1);
    } else {
      positional.push(token);
    }
  }
  return { positional, options: { json, strict } };
}

function parseAuditArgs(argv: readonly string[]): AuditCommand {
  const { positional, options } = partitionArgs(argv);
  if (positional.length !== 1) {
    console.error('audit: expected exactly one <packDir> argument');
    printHelpAndExit(1);
  }
  return {
    kind: 'audit',
    packDir: ensureAbsolute(positional[0]),
    options,
  };
}

function parseDiffArgs(argv: readonly string[]): DiffCommand {
  const { positional, options } = partitionArgs(argv);
  if (positional.length !== 2) {
    console.error('diff: expected <baselineDir> and <candidateDir> arguments');
    printHelpAndExit(1);
  }
  return {
    kind: 'diff',
    beforeDir: ensureAbsolute(positional[0]),
    afterDir: ensureAbsolute(positional[1]),
    options,
  };
}

function printHelpAndExit(code: number): never {
  const text = [
    'Usage:',
    '  rules-pack-audit audit <packDir> [--json] [--strict]',
    '  rules-pack-audit diff  <baselineDir> <candidateDir> [--json] [--strict]',
    '',
    'Subcommands:',
    '  audit    Run heuristic checks (suspicious records, partially-populated',
    '           data fields) and per-kind record counts on one pack.',
    '  diff     Compare two pack directories and report manifest deltas plus',
    '           added/removed/changed records with per-field diffs.',
    '',
    'Flags:',
    '  --json    Emit the JSON form of the report instead of plain text.',
    '  --strict  Exit nonzero when findings/changes exist (CI gating).',
    '',
    'Exit codes:',
    '  0  success (and, without --strict, regardless of findings/changes)',
    '  1  --strict and findings or changes were detected',
    '  2  pack failed validation or could not be loaded',
  ].join('\n');
  if (code === 0) {
    console.log(text);
  } else {
    console.error(text);
  }
  process.exit(code);
}

function runAudit(command: AuditCommand): number {
  const pack = loadOrExit(command.packDir);
  const audit = auditPack(pack);
  if (command.options.json) {
    console.log(JSON.stringify(audit, null, 2));
  } else {
    process.stdout.write(formatAuditReport(audit));
  }
  if (command.options.strict && auditHasFindings(audit)) {
    return 1;
  }
  return 0;
}

function runDiff(command: DiffCommand): number {
  const before = loadOrExit(command.beforeDir);
  const after = loadOrExit(command.afterDir);
  const diff = diffPacks(before, after);
  if (command.options.json) {
    console.log(JSON.stringify(diff, null, 2));
  } else {
    process.stdout.write(formatDiffReport(diff));
  }
  if (command.options.strict && diffHasChanges(diff)) {
    return 1;
  }
  return 0;
}

function loadOrExit(
  dir: string,
): ReturnType<typeof loadRulesPackFromDirectory> {
  try {
    return loadRulesPackFromDirectory(dir);
  } catch (cause) {
    if (cause instanceof RulesPackError) {
      console.error(`pack at ${dir} failed validation: ${cause.message}`);
    } else {
      console.error(
        `failed to load pack at ${dir}: ${(cause as Error).message}`,
      );
    }
    process.exit(2);
  }
}

function main(): void {
  const command = parseArgs(process.argv.slice(2));
  const code = command.kind === 'audit' ? runAudit(command) : runDiff(command);
  process.exit(code);
}

main();
