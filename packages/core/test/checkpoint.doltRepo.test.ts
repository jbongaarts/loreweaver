import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DoltRepo } from '../src/persistence/checkpoint/doltRepo.js';
import type { SnapshotRecord } from '../src/persistence/checkpoint/serialize.js';

const doltOk = DoltRepo.available();
const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'lw-dolt-'));
  dirs.push(d);
  return d;
}
afterAll(() => {
  /* temp dirs are OS-cleaned; explicit rm omitted for cross-platform safety */
});

const SNAP: SnapshotRecord[] = [
  { table: 'meta', kind: 'schema', ordinal: 0, payload: JSON.stringify({ create: 'CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)' }) },
  { table: 'meta', kind: 'row', ordinal: 0, payload: JSON.stringify({ key: 'a', value: '1' }) },
];

describe.skipIf(!doltOk)('DoltRepo', () => {
  it('init + applySnapshot + commit yields a listable checkpoint', () => {
    const repo = new DoltRepo(join(tmp(), 'dolt'));
    repo.init();
    repo.applySnapshot(SNAP);
    const id = repo.commit('checkpoint: test');
    expect(id).toMatch(/\S+/);
    const log = repo.log();
    expect(log.length).toBeGreaterThanOrEqual(1);
    expect(log[0]?.message).toContain('checkpoint: test');
  });
});

describe('DoltRepo.available', () => {
  it('returns a boolean', () => {
    expect(typeof DoltRepo.available()).toBe('boolean');
  });
});
