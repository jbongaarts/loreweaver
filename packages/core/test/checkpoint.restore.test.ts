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

describe.skipIf(!doltOk)('CheckpointStore.restoreToNewWorkingCopy', () => {
  it('restores a checkpoint into a new db identical to the source', () => {
    const root = mkdtempSync(join(tmpdir(), 'lw-rs-'));
    const src = join(root, 'live.db');
    const db = openDatabase(src);
    db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
    db.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run('hp', '7');
    db.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run('gp', '42');
    const before = canonicalize(serializeCampaign(db));
    db.close();

    const store = new CheckpointStore(join(root, 'dolt'), join(root, '.beads'));
    const id = store.checkpoint(src, 'cp1');

    const dest = join(root, 'restored.db');
    store.restoreToNewWorkingCopy(id, dest);

    const rdb = openDatabase(dest);
    const after = canonicalize(serializeCampaign(rdb));
    rdb.close();
    expect(after).toBe(before);
  });
});
