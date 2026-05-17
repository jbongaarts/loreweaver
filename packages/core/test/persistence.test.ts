import { describe, expect, it } from 'vitest';
import { openDatabase, withTransaction } from '../src/persistence/db.js';
import { initSchema, SCHEMA_VERSION } from '../src/persistence/schema.js';

describe('persistence', () => {
  it('initSchema records the schema version', () => {
    const db = openDatabase(':memory:');
    initSchema(db);
    const row = db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    expect(row?.value).toBe(String(SCHEMA_VERSION));
    db.close();
  });

  it('withTransaction commits on success', () => {
    const db = openDatabase(':memory:');
    initSchema(db);
    withTransaction(db, (d) =>
      d.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run('a', '1'),
    );
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('a') as
      | { value: string }
      | undefined;
    expect(row?.value).toBe('1');
    db.close();
  });

  it('withTransaction rolls back when the function throws', () => {
    const db = openDatabase(':memory:');
    initSchema(db);
    expect(() =>
      withTransaction(db, (d) => {
        d.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run('b', '2');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('b');
    expect(row).toBeUndefined();
    db.close();
  });
});
