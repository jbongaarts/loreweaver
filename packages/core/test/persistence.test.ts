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

  it('initSchema creates canonical game-state tables with provenance columns', () => {
    const db = openDatabase(':memory:');
    initSchema(db);

    const expectedTables = [
      'character',
      'inventory',
      'plot_flags',
      'clock',
      'overlay_facts',
    ];
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining(expectedTables),
    );

    for (const table of expectedTables) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
      }>;
      expect(columns.map((column) => column.name)).toEqual(
        expect.arrayContaining(['provenance', 'session_id', 'updated_at']),
      );
    }

    const characterRows = db.prepare('SELECT id FROM character').all();
    expect(characterRows).toEqual([{ id: 1 }]);

    const clockRows = db.prepare('SELECT id FROM clock').all();
    expect(clockRows).toEqual([{ id: 1 }]);

    db.close();
  });
});
