import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SeparationError,
  assertSeparateFromBeads,
  normalizeRemoteUrl,
  readDoltRemotes,
  BEADS_RESERVED_REF,
} from '../src/persistence/checkpoint/separation.js';

/** Write a minimal `.dolt/repo_state.json` with the given remotes. */
function doltRepoWithRemotes(
  remotes: Record<string, { url: string; fetch_specs?: string[] }>,
): string {
  const dir = mkdtempSync(join(tmpdir(), 'lw-sep-'));
  mkdirSync(join(dir, '.dolt'), { recursive: true });
  const full: Record<string, unknown> = {};
  for (const [name, r] of Object.entries(remotes)) {
    full[name] = {
      name,
      url: r.url,
      fetch_specs: r.fetch_specs ?? [
        'refs/heads/*:refs/remotes/' + name + '/*',
      ],
      params: {},
    };
  }
  writeFileSync(
    join(dir, '.dolt', 'repo_state.json'),
    JSON.stringify({ head: 'refs/heads/main', remotes: full, branches: {} }),
  );
  return dir;
}

describe('beads-Dolt separation guard', () => {
  it('allows a clearly disjoint dolt dir', () => {
    expect(() =>
      assertSeparateFromBeads('/proj/.loreweaver/dolt', '/proj/.beads'),
    ).not.toThrow();
  });

  it('rejects a dolt dir equal to the beads dir', () => {
    expect(() =>
      assertSeparateFromBeads('/proj/.beads', '/proj/.beads'),
    ).toThrow(SeparationError);
  });

  it('rejects a dolt dir nested inside the beads dir', () => {
    expect(() =>
      assertSeparateFromBeads('/proj/.beads/dolt', '/proj/.beads'),
    ).toThrow(SeparationError);
  });

  it('rejects a dolt dir that contains the beads dir', () => {
    expect(() => assertSeparateFromBeads('/proj', '/proj/.beads')).toThrow(
      SeparationError,
    );
  });

  it('exposes the reserved beads ref so callers never reuse it', () => {
    expect(BEADS_RESERVED_REF).toBe('refs/dolt/data');
  });
});

describe('normalizeRemoteUrl', () => {
  it('treats trailing slash, .git suffix and case as equivalent', () => {
    expect(normalizeRemoteUrl('https://Git.example.com/Beads.git')).toBe(
      normalizeRemoteUrl('https://git.example.com/beads/'),
    );
  });
});

describe('readDoltRemotes', () => {
  it('returns [] when there is no repo_state.json', () => {
    expect(readDoltRemotes(mkdtempSync(join(tmpdir(), 'lw-empty-')))).toEqual(
      [],
    );
  });

  it('parses configured remotes', () => {
    const dir = doltRepoWithRemotes({ origin: { url: 'file:///srv/x' } });
    expect(readDoltRemotes(dir)).toEqual([
      {
        name: 'origin',
        url: 'file:///srv/x',
        fetchSpecs: ['refs/heads/*:refs/remotes/origin/*'],
      },
    ]);
  });
});

describe('beads remote / ref-namespace collision guard', () => {
  it('allows campaign and beads repos with disjoint remotes', () => {
    const campaign = doltRepoWithRemotes({
      origin: { url: 'file:///srv/loreweaver-campaign' },
    });
    const beads = doltRepoWithRemotes({
      origin: { url: 'https://git.example.com/team/repo.git' },
    });
    expect(() => assertSeparateFromBeads(campaign, beads)).not.toThrow();
  });

  it('rejects a campaign repo sharing a remote URL with the beads repo', () => {
    const shared = 'https://git.example.com/team/repo.git';
    const campaign = doltRepoWithRemotes({ origin: { url: shared + '/' } });
    const beads = doltRepoWithRemotes({ origin: { url: shared } });
    expect(() => assertSeparateFromBeads(campaign, beads)).toThrow(
      SeparationError,
    );
  });

  it('rejects a campaign remote that targets the beads reserved ref namespace', () => {
    const campaign = doltRepoWithRemotes({
      sync: {
        url: 'file:///srv/campaign',
        fetch_specs: [`${BEADS_RESERVED_REF}:${BEADS_RESERVED_REF}`],
      },
    });
    const beads = doltRepoWithRemotes({ origin: { url: 'file:///srv/beads' } });
    expect(() => assertSeparateFromBeads(campaign, beads)).toThrow(
      SeparationError,
    );
  });

  it('rejects any campaign remote using a refs/dolt/* fetch spec', () => {
    const campaign = doltRepoWithRemotes({
      sync: {
        url: 'file:///srv/campaign',
        fetch_specs: ['refs/dolt/foo:refs/dolt/foo'],
      },
    });
    const beads = doltRepoWithRemotes({ origin: { url: 'file:///srv/beads' } });
    expect(() => assertSeparateFromBeads(campaign, beads)).toThrow(
      SeparationError,
    );
  });
});
