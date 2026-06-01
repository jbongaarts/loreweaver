/**
 * Smoke test for the rules-pack audit/diff CLI. Spawns the script via tsx
 * against fixture pack directories so the real argv parser, file I/O, and
 * exit-code wiring are exercised end-to-end.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const CLI_PATH = resolve(
  REPO_ROOT,
  'packages/core/scripts/rules-pack-audit/cli.ts',
);

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rules-pack-audit-cli-'));
  tmpDirs.push(dir);
  return dir;
}

const SOURCE_URL = 'https://example.test/srd/5.1';

const LICENSE = {
  licenseClass: 'open',
  licenseName: 'Creative Commons Attribution 4.0 International',
  attributionText: 'Rules text derived from an open SRD fixture.',
  requiresAttribution: true,
  commercialUseAllowed: true,
  hostedUseAllowed: true,
  redistributionAllowed: true,
  publicSharingAllowed: true,
  derivativeAllowed: true,
  containsUserSuppliedText: false,
  containsTrademarkedSettingMaterial: false,
  sourceMaterialDescription: 'Open fantasy rules reference.',
  provenancePolicy: 'Every record includes source and license metadata.',
  outputRestrictions: 'Preserve attribution on redistributed records.',
};

function manifest(): Record<string, unknown> {
  return {
    packId: 'rules:fixture-srd',
    title: 'Fixture SRD',
    description: 'Fixture pack for CLI smoke.',
    role: 'base',
    systemId: 'fixture-srd',
    version: '1.0',
    license: LICENSE,
    source: {
      sourceTitle: 'Fixture',
      sourceVersion: '1.0',
      sourceUrl: SOURCE_URL,
      recordProvenancePolicy: 'Every record carries a fixture locator.',
    },
  };
}

function record(
  key: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    systemId: 'fixture-srd',
    kind: 'spell',
    key,
    name: 'Acid Splash',
    data: { level: 0, school: 'conjuration', description: 'x' },
    source: 'Fixture p. 1',
    license: LICENSE,
    provenance: { sourceRef: SOURCE_URL, locator: 'p. 1' },
    ...overrides,
  };
}

function writePack(
  dir: string,
  records: ReadonlyArray<Record<string, unknown>>,
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'manifest.json'),
    `${JSON.stringify(manifest(), null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    join(dir, 'records.json'),
    `${JSON.stringify(records, null, 2)}\n`,
    'utf8',
  );
}

function runCli(args: readonly string[]): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', CLI_PATH, ...args],
    { encoding: 'utf8' },
  );
  return {
    status: result.status ?? 0,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe('rules-pack-audit CLI', () => {
  it('prints a human-readable audit report and exits 0 by default', () => {
    const packDir = join(makeTmpDir(), 'pack');
    writePack(packDir, [record('spell:acid-splash')]);
    const result = runCli(['audit', packDir]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Audit for pack: rules:fixture-srd');
    expect(result.stdout).toContain('Total records: 1');
    expect(result.stdout).toContain('spell: 1');
  });

  it('emits JSON when --json is passed', () => {
    const packDir = join(makeTmpDir(), 'pack');
    writePack(packDir, [record('spell:acid-splash')]);
    const result = runCli(['audit', packDir, '--json']);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { packId: string };
    expect(parsed.packId).toBe('rules:fixture-srd');
  });

  it('exits 1 under --strict when an audit finds an issue', () => {
    const packDir = join(makeTmpDir(), 'pack');
    writePack(packDir, [
      record('spell:acid-splash'),
      // All-uppercase name trips the suspicious-record heuristic.
      record('spell:actions', { name: 'ACTIONS' }),
    ]);
    const result = runCli(['audit', packDir, '--strict']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('Suspicious records: 1');
  });

  it('exits 2 when the pack fails validation', () => {
    const packDir = join(makeTmpDir(), 'pack');
    mkdirSync(packDir, { recursive: true });
    writeFileSync(
      join(packDir, 'manifest.json'),
      `${JSON.stringify({ ...manifest(), packId: '' }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(join(packDir, 'records.json'), '[]\n', 'utf8');
    const result = runCli(['audit', packDir]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('failed validation');
  });

  it('diffs two packs and reports per-record deltas', () => {
    const baseDir = join(makeTmpDir(), 'a');
    const candDir = join(makeTmpDir(), 'b');
    writePack(baseDir, [record('spell:acid-splash')]);
    writePack(candDir, [
      record('spell:acid-splash'),
      record('spell:fire-bolt', { name: 'Fire Bolt' }),
    ]);
    const result = runCli(['diff', baseDir, candDir]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Records added: 1');
    expect(result.stdout).toContain('+ spell:fire-bolt');
  });

  it('exits 1 under --strict when a diff shows changes', () => {
    const baseDir = join(makeTmpDir(), 'a');
    const candDir = join(makeTmpDir(), 'b');
    writePack(baseDir, [record('spell:acid-splash')]);
    writePack(candDir, [
      record('spell:acid-splash'),
      record('spell:fire-bolt', { name: 'Fire Bolt' }),
    ]);
    const result = runCli(['diff', baseDir, candDir, '--strict']);
    expect(result.status).toBe(1);
  });

  it('exits 1 with help text when no arguments are given', () => {
    const result = runCli([]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage:');
  });
});
