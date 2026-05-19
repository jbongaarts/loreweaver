import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DoltUnavailableError } from '../src/persistence/checkpoint/doltBinary.js';
import {
  DOLT_PINNED_VERSION,
  DoltUnverifiedError,
  doltAssetFor,
  ensureDoltAvailable,
  provisionDolt,
  verifyArchive,
} from '../src/persistence/checkpoint/doltProvision.js';

function tmpFile(content: string): string {
  const p = join(mkdtempSync(join(tmpdir(), 'lw-arc-')), 'a.bin');
  writeFileSync(p, content);
  return p;
}

describe('doltAssetFor', () => {
  it('maps known platforms to pinned asset + sha + pinned-version url', () => {
    const a = doltAssetFor('win32', 'x64');
    expect(a.asset).toBe('dolt-windows-amd64.zip');
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.url).toContain(`/download/${DOLT_PINNED_VERSION}/dolt-windows-amd64.zip`);
    expect(doltAssetFor('linux', 'arm64').asset).toBe('dolt-linux-arm64.tar.gz');
  });

  it('throws DoltUnavailableError for an unsupported platform/arch', () => {
    expect(() => doltAssetFor('sunos' as NodeJS.Platform, 'mips')).toThrow(
      DoltUnavailableError,
    );
  });
});

describe('verifyArchive (fail closed)', () => {
  it('rejects an unpinned/sentinel checksum', () => {
    const f = tmpFile('whatever');
    expect(() => verifyArchive(f, 'UNPINNED')).toThrow(DoltUnverifiedError);
    expect(() => verifyArchive(f, '')).toThrow(DoltUnverifiedError);
  });

  it('rejects a checksum mismatch', () => {
    const f = tmpFile('payload');
    expect(() => verifyArchive(f, 'a'.repeat(64))).toThrow(DoltUnverifiedError);
  });

  it('accepts a matching checksum', () => {
    const f = tmpFile('payload');
    const good = createHash('sha256').update('payload').digest('hex');
    expect(() => verifyArchive(f, good)).not.toThrow();
  });
});

describe('provisionDolt fails closed before extracting if checksum is wrong', () => {
  it('throws DoltUnverifiedError and never extracts', async () => {
    const extract = vi.fn();
    await expect(
      provisionDolt({
        platform: 'linux',
        arch: 'x64',
        download: (_url, dest) => writeFileSync(dest, 'not-the-real-archive'),
        extract,
      }),
    ).rejects.toBeInstanceOf(DoltUnverifiedError);
    expect(extract).not.toHaveBeenCalled();
  });
});

describe('ensureDoltAvailable decision tree', () => {
  const okResolve = () => '/usr/bin/dolt';
  const failResolve = () => {
    throw new DoltUnavailableError('none');
  };

  it('returns an already-present dolt without prompting or installing', async () => {
    const confirm = vi.fn();
    const provision = vi.fn();
    const got = await ensureDoltAvailable({
      env: {},
      resolve: okResolve,
      confirm,
      provision,
    });
    expect(got).toBe('/usr/bin/dolt');
    expect(confirm).not.toHaveBeenCalled();
    expect(provision).not.toHaveBeenCalled();
  });

  it('prompts (reason=not-found) and installs on approval', async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const provision = vi.fn().mockResolvedValue('/home/u/.loreweaver/dolt/dolt');
    const got = await ensureDoltAvailable({
      env: {},
      platform: 'linux',
      arch: 'x64',
      resolve: failResolve,
      confirm,
      provision,
    });
    expect(got).toBe('/home/u/.loreweaver/dolt/dolt');
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0][0]).toMatchObject({
      reason: 'not-found',
      version: DOLT_PINNED_VERSION,
    });
    expect(provision).toHaveBeenCalledOnce();
  });

  it('does not install when the user declines (not-found)', async () => {
    const provision = vi.fn();
    await expect(
      ensureDoltAvailable({
        env: {},
        platform: 'linux',
        arch: 'x64',
        resolve: failResolve,
        confirm: () => false,
        provision,
      }),
    ).rejects.toBeInstanceOf(DoltUnavailableError);
    expect(provision).not.toHaveBeenCalled();
  });

  it('with LOREWEAVER_DOLT_BIN set but missing: never auto-installs, prompts reason=explicit-path-missing, declines safely', async () => {
    const provision = vi.fn();
    const confirm = vi.fn().mockResolvedValue(false);
    let err: unknown;
    try {
      await ensureDoltAvailable({
        env: { LOREWEAVER_DOLT_BIN: '/nope/dolt' },
        platform: 'linux',
        arch: 'x64',
        resolve: failResolve,
        confirm,
        provision,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DoltUnavailableError);
    expect((err as Error).message).toContain('/nope/dolt');
    expect(confirm.mock.calls[0][0]).toMatchObject({
      reason: 'explicit-path-missing',
      explicitPath: '/nope/dolt',
    });
    expect(provision).not.toHaveBeenCalled();
  });

  it('with LOREWEAVER_DOLT_BIN set but missing: installs only on explicit approval', async () => {
    const provision = vi.fn().mockResolvedValue('/home/u/.loreweaver/dolt/dolt');
    const got = await ensureDoltAvailable({
      env: { LOREWEAVER_DOLT_BIN: '/nope/dolt' },
      platform: 'linux',
      arch: 'x64',
      resolve: failResolve,
      confirm: () => true,
      provision,
    });
    expect(got).toBe('/home/u/.loreweaver/dolt/dolt');
    expect(provision).toHaveBeenCalledOnce();
  });
});
