import type { Db } from './db.js';
import { withTransaction } from './db.js';

export class SchemaMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaMigrationError';
  }
}

export type Migration = (db: Db) => void;

// v7 → v8: added campaign_arc (with one-open partial index), arc_id column on
// campaign_session, and campaign_rules_binding singleton.
const v7_to_v8: Migration = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_arc (
      campaign_id  TEXT NOT NULL,
      arc_id       TEXT NOT NULL,
      sequence_no  INTEGER NOT NULL,
      status       TEXT NOT NULL CHECK (status IN ('open', 'closed')),
      opened_at    TEXT NOT NULL,
      closed_at    TEXT,
      PRIMARY KEY (campaign_id, arc_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS campaign_arc_one_open
      ON campaign_arc(campaign_id) WHERE status = 'open';
    CREATE TABLE IF NOT EXISTS campaign_rules_binding (
      id              INTEGER PRIMARY KEY CHECK (id = 1),
      base_system_id  TEXT NOT NULL,
      base_pack_id    TEXT NOT NULL,
      base_version    TEXT NOT NULL,
      addons_json     TEXT NOT NULL DEFAULT '[]',
      resolved_at     TEXT NOT NULL
    );
  `);
  // SQLite ALTER TABLE does not support IF NOT EXISTS; guard with a pragma check.
  const cols = db.prepare('PRAGMA table_info(campaign_session)').all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === 'arc_id')) {
    db.exec('ALTER TABLE campaign_session ADD COLUMN arc_id TEXT');
  }
};

export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  8: v7_to_v8,
};

/**
 * Run registered migrations in ascending version order from `fromVersion + 1`
 * to `toVersion` (inclusive). Each step is wrapped in its own transaction and
 * updates `meta.schema_version` atomically, so a partial run leaves the DB at
 * the last successfully migrated version.
 *
 * Throws `SchemaMigrationError` if any step is missing or fails.
 */
export function migrateSchema(
  db: Db,
  fromVersion: number,
  toVersion: number,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
): void {
  // Pre-flight: verify every required step exists before touching the DB.
  for (let v = fromVersion + 1; v <= toVersion; v++) {
    if (migrations[v] === undefined) {
      throw new SchemaMigrationError(`no migration defined for version ${v}`);
    }
  }
  for (let v = fromVersion + 1; v <= toVersion; v++) {
    try {
      withTransaction(db, (txnDb) => {
        const migration = migrations[v];
        if (migration === undefined) {
          throw new SchemaMigrationError(
            `no migration defined for version ${v}`,
          );
        }
        migration(txnDb);
        txnDb
          .prepare('UPDATE meta SET value = ? WHERE key = ?')
          .run(String(v), 'schema_version');
      });
    } catch (err) {
      if (err instanceof SchemaMigrationError) throw err;
      throw new SchemaMigrationError(
        `migration to version ${v} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
