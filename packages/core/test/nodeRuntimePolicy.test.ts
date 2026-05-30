import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface BiomeJson {
  vcs?: {
    enabled?: boolean;
    clientKind?: string;
    useIgnoreFile?: boolean;
  };
  files?: {
    includes?: string[];
  };
}

function readText(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function readJson<T>(path: string): T {
  return JSON.parse(readText(path)) as T;
}

function readPackageJson(path: string): PackageJson {
  return readJson<PackageJson>(path);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expectDependabotMajorIgnore(dependabot: string, dependency: string) {
  expect(dependabot).toMatch(
    new RegExp(
      `dependency-name:\\s*["']${escapeRegExp(
        dependency,
      )}["'][\\s\\S]*?update-types:\\s*\\r?\\n\\s*-\\s*["']version-update:semver-major["']`,
    ),
  );
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

  it('keeps CI on Node 24 with cross-platform install smoke coverage', () => {
    const ci = readText('.github/workflows/ci.yml');

    expect(ci).toMatch(/node-version:\s*24/);
    expect(ci).not.toMatch(/node-version:\s*22|Node 22|better-sqlite3 11/);
    expect(ci).toContain('install-smoke:');
    expect(ci).toMatch(
      /os:\s*\[ubuntu-latest,\s*windows-latest,\s*macos-latest\]/,
    );
    expect(ci).toContain('npm ci --foreground-scripts');
    expect(ci).toContain('npm run smoke:cli-install');
    expect(ci).toContain('gyp info');
    expect(ci).toContain('CXX\\(target\\)');
    expect(ci).toContain('prebuild-install WARN install');
    expect(ci).toContain('node-gyp rebuild');
  });

  it('documents the same Node 24 dependency policy for agents', () => {
    const agents = readText('AGENTS.md');

    expect(agents).toContain('Node 24 LTS');
    expect(agents).toContain('`>=24 <25`');
    expect(agents).toContain('`better-sqlite3` 12.x');
    expect(agents).toContain('`@types/node`');
    expect(agents).toMatch(/Linux,\s+Windows, and macOS/);
    expect(agents).toMatch(/source-build fallback.*regression/i);
    expect(agents).not.toMatch(/Node 22|11\.x/);
  });

  it('makes Biome 2 respect gitignored local and generated artifacts', () => {
    const biome = readJson<BiomeJson>('biome.json');
    const gitignore = readText('.gitignore');

    expect(biome.vcs).toEqual({
      enabled: true,
      clientKind: 'git',
      useIgnoreFile: true,
    });
    expect(biome.files?.includes ?? []).toEqual(
      expect.arrayContaining([
        '**',
        '!**/node_modules',
        '!**/dist',
        '!**/coverage',
        '!**/.beads',
        '!**/.worktrees',
        '!**/package-lock.json',
      ]),
    );
    expect(gitignore).toContain('.dolt/');
    expect(gitignore).toContain('*.db');
    expect(gitignore).toContain('.env');
    expect(gitignore).toContain('.claude/settings.local.json');
    expect(gitignore).toContain(
      'packages/core/scripts/importers/*/.generated/',
    );
    expect(gitignore).toContain('packages/core/sources/*/*.pdf');
  });

  it('requires manual review for major runtime and toolchain updates', () => {
    const dependabot = readText('.github/dependabot.yml');

    for (const dependency of [
      'better-sqlite3',
      '@types/node',
      '@biomejs/biome',
      'typescript',
    ]) {
      expectDependabotMajorIgnore(dependabot, dependency);
    }
  });
});
