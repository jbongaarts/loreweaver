import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/persistence/db.js';
import {
  serializeCampaign,
  canonicalize,
} from '../src/persistence/checkpoint/serialize.js';

function seed(rowsReversed: boolean) {
  const db = openDatabase(':memory:');
  db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);');
  const pairs = [
    ['b', '2'],
    ['a', '1'],
  ];
  for (const [k, v] of rowsReversed ? [...pairs].reverse() : pairs) {
    db.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run(k, v);
  }
  db.prepare('INSERT INTO notes(id, body) VALUES (?, ?)').run(1, null);
  return db;
}

describe('deterministic serialization', () => {
  it('is identical regardless of physical insert order', () => {
    const s1 = canonicalize(serializeCampaign(seed(false)));
    const s2 = canonicalize(serializeCampaign(seed(true)));
    expect(s1).toBe(s2);
  });

  it('orders tables by name and is stable across runs', () => {
    const s1 = canonicalize(serializeCampaign(seed(false)));
    const s2 = canonicalize(serializeCampaign(seed(false)));
    expect(s1).toBe(s2);
    expect(s1.indexOf('"table":"meta"')).toBeLessThan(
      s1.indexOf('"table":"notes"'),
    );
  });

  it('excludes sqlite internal tables', () => {
    const s = canonicalize(serializeCampaign(seed(false)));
    expect(s).not.toContain('sqlite_');
  });
});
