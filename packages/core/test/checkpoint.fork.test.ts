import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DoltRepo } from '../src/persistence/checkpoint/doltRepo.js';
import {
  canonicalize,
  serializeCampaign,
} from '../src/persistence/checkpoint/serialize.js';
import { CheckpointStore } from '../src/persistence/checkpoint/store.js';
import { openDatabase } from '../src/persistence/db.js';

const doltOk = DoltRepo.available();

describe.skipIf(!doltOk)('CheckpointStore.forkFromCheckpoint', () => {
  it('forks a checkpoint into an isolated branch + working copy', { timeout: 30000 }, () => {
    const root = mkdtempSync(join(tmpdir(), 'lw-fk-'));
    const src = join(root, 'live.db');
    const db = openDatabase(src);
    db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
    db.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run('hp', '5');
    db.close();

    const store = new CheckpointStore(join(root, 'dolt'), join(root, '.beads'));
    const c1 = store.checkpoint(src, 'cp1');

    const forkDb = join(root, 'fork.db');
    store.forkFromCheckpoint(c1, 'what-if', forkDb);
    const fdb = openDatabase(forkDb);
    const forkHp = fdb.prepare("SELECT value FROM meta WHERE key='hp'").get();
    const forkState = canonicalize(serializeCampaign(fdb));

    // Mutate the live db and checkpoint again on the main line.
    const db2 = openDatabase(src);
    db2.prepare('UPDATE meta SET value = ? WHERE key = ?').run('999', 'hp');
    db2.close();
    store.checkpoint(src, 'cp2-mainline');

    // Re-restore the fork branch tip: it must still equal the c1 state.
    const forkDb2 = join(root, 'fork2.db');
    store.forkFromCheckpoint(c1, 'what-if-2', forkDb2);
    const fdb2 = openDatabase(forkDb2);
    const forkHp2 = fdb2.prepare("SELECT value FROM meta WHERE key='hp'").get();
    const forkState2 = canonicalize(serializeCampaign(fdb2));

    // The fork's working copy holds the c1 value, fully isolated from the
    // later mainline checkpoint (acceptance #4). NOTE: assert on the
    // materialized SQLite rows, not substrings of canonicalize() — that
    // output JSON-escapes every quote, so the brief's `toContain('"hp"')`
    // could never match even on a correct fork.
    expect(forkHp).toEqual({ value: '5' });
    expect(forkHp2).toEqual({ value: '5' });
    expect(forkState2).toBe(forkState);
    expect(forkState2).not.toContain('999');
  });
});
