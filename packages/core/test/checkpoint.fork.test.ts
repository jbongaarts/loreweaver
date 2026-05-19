import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/persistence/db.js';
import { DoltRepo } from '../src/persistence/checkpoint/doltRepo.js';
import { CheckpointStore } from '../src/persistence/checkpoint/store.js';
import {
  serializeCampaign,
  canonicalize,
} from '../src/persistence/checkpoint/serialize.js';

const doltOk = DoltRepo.available();

describe.skipIf(!doltOk)('CheckpointStore.forkFromCheckpoint', () => {
  it('forks a checkpoint into an isolated branch + working copy', () => {
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
    const forkState = canonicalize(serializeCampaign(openDatabase(forkDb)));

    // Mutate the live db and checkpoint again on the main line.
    const db2 = openDatabase(src);
    db2.prepare('UPDATE meta SET value = ? WHERE key = ?').run('999', 'hp');
    db2.close();
    store.checkpoint(src, 'cp2-mainline');

    // Re-restore the fork branch tip: it must still equal the c1 state.
    const forkDb2 = join(root, 'fork2.db');
    store.forkFromCheckpoint(c1, 'what-if-2', forkDb2);
    const forkState2 = canonicalize(serializeCampaign(openDatabase(forkDb2)));

    expect(forkState).toContain('"hp"');
    expect(forkState).toContain('5');
    expect(forkState2).toBe(forkState);
    expect(forkState2).not.toContain('999');
  });
});
