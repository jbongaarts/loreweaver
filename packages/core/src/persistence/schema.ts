import type { Db } from './db.js';

export const SCHEMA_VERSION = 1;

export function initSchema(db: Db): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
  );
  db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run(
    'schema_version',
    String(SCHEMA_VERSION),
  );
}
