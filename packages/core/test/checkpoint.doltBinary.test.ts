import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DoltUnavailableError,
  managedDoltDir,
  managedDoltRoot,
  resolveDoltBinary,
} from '../src/persistence/checkpoint/doltBinary.js';

function fakeBin(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'lw-doltbin-'));
  const p = join(dir, name);
  writeFileSync(p, '#!/bin/sh\necho dolt\n');
  try {
    chmodSync(p, 0o755);
  } catch {
    /* chmod is a no-op / may throw on some Windows FS — non-fatal for the test */
  }
  return p;
}

const isWin = process.platform === 'win32';
const BIN = isWin ? 'dolt.exe' : 'dolt';

/** An isolated, empty managed-home so a real ~/.loreweaver/dolt install on the
 * host machine can never leak into precedence assertions. */
function emptyHome(): string {
  return mkdtempSync(join(tmpdir(), 'lw-emptyhome-'));
}

describe('resolveDoltBinary precedence', () => {
  it('returns an explicit override path when it exists', () => {
    const p = fakeBin(BIN);
    expect(resolveDoltBinary({ explicitPath: p, env: {}, pathDirs: [] })).toBe(
      p,
    );
  });

  it('honors the LOREWEAVER_DOLT_BIN env override', () => {
    const p = fakeBin(BIN);
    expect(
      resolveDoltBinary({ env: { LOREWEAVER_DOLT_BIN: p }, pathDirs: [] }),
    ).toBe(p);
  });

  it('uses the managed cache dir before PATH', () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'lw-dolthome-'));
    const cached = join(cacheDir, BIN);
    writeFileSync(cached, 'x');
    const onPath = fakeBin(BIN);
    const resolved = resolveDoltBinary({
      env: { LOREWEAVER_DOLT_HOME: cacheDir },
      pathDirs: [join(onPath, '..')],
    });
    expect(resolved).toBe(cached);
  });

  it('falls back to a PATH directory', () => {
    const p = fakeBin(BIN);
    expect(
      resolveDoltBinary({
        env: { LOREWEAVER_DOLT_HOME: emptyHome() },
        pathDirs: [join(p, '..')],
      }),
    ).toBe(p);
  });

  it('throws an actionable DoltUnavailableError when nothing resolves', () => {
    let err: unknown;
    try {
      resolveDoltBinary({
        env: { LOREWEAVER_DOLT_HOME: emptyHome() },
        pathDirs: [],
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DoltUnavailableError);
    const msg = (err as Error).message;
    expect(msg).toContain('LOREWEAVER_DOLT_BIN');
    expect(msg.toLowerCase()).toContain('dolt');
  });

  it('rejects an explicit override that does not exist', () => {
    expect(() =>
      resolveDoltBinary({
        explicitPath: join(tmpdir(), 'definitely-not-here', BIN),
        env: { LOREWEAVER_DOLT_HOME: emptyHome() },
        pathDirs: [],
      }),
    ).toThrow(DoltUnavailableError);
  });
});

describe('managedDoltRoot', () => {
  it('is a "root" subdir of the managed dolt dir (isolated global home)', () => {
    const env = { LOREWEAVER_DOLT_HOME: '/opt/dolt' };
    expect(managedDoltRoot(env)).toBe(join('/opt/dolt', 'root'));
    expect(managedDoltRoot(env)).toBe(join(managedDoltDir(env), 'root'));
  });

  it('honors LOREWEAVER_DOLT_HOME so the root never lands in the user home', () => {
    const home = emptyHome();
    expect(managedDoltRoot({ LOREWEAVER_DOLT_HOME: home })).toBe(
      join(home, 'root'),
    );
  });

  it('is a sibling of the binary, never the binary dir itself', () => {
    const env = { LOREWEAVER_DOLT_HOME: '/opt/dolt' };
    expect(managedDoltRoot(env)).not.toBe(managedDoltDir(env));
  });
});
