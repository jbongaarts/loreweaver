import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DoltRepo } from '../src/persistence/checkpoint/doltRepo.js';
import { CheckpointStore } from '../src/persistence/checkpoint/store.js';
import { openDatabase } from '../src/persistence/db.js';

const doltOk = DoltRepo.available();
function ws() {
  return mkdtempSync(join(tmpdir(), 'lw-cp-'));
}

describe.skipIf(!doltOk)('CheckpointStore.checkpoint/list', () => {
  it('checkpoints a live SQLite db and lists it', () => {
    const root = ws();
    const dbPath = join(root, 'live.db');
    const db = openDatabase(dbPath);
    db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
    db.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run('hp', '10');
    db.close();

    const store = new CheckpointStore(join(root, 'dolt'), join(root, '.beads'));
    const id = store.checkpoint(dbPath, 'session-close: s1');
    expect(id).toMatch(/\S+/);

    const list = store.list();
    expect(list.some((c) => c.message.includes('session-close: s1'))).toBe(
      true,
    );
  });
});

describe('CheckpointStore separation guard (no dolt needed)', () => {
  it('refuses a dolt dir colocated with beads', () => {
    const root = ws();
    expect(
      () => new CheckpointStore(join(root, '.beads'), join(root, '.beads')),
    ).toThrow();
  });
});
