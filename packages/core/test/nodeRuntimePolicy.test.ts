import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(path: string): PackageJson {
  return JSON.parse(readFileSync(join(process.cwd(), path), 'utf8'));
}

describe('Node runtime policy', () => {
  it('supports Node 24 with a matching native SQLite dependency line', () => {
    const root = readPackageJson('package.json');
    const core = readPackageJson('packages/core/package.json');
    const cli = readPackageJson('packages/cli/package.json');

    expect(root.engines?.node).toBe('>=24 <25');
    expect(core.engines?.node).toBe('>=24 <25');
    expect(cli.engines?.node).toBe('>=24 <25');
    expect(core.dependencies?.['better-sqlite3']).toMatch(/^\^12\./);
    expect(root.devDependencies?.['@types/node']).toMatch(/^\^24\./);
  });
});
