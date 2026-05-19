import type { Db } from './db.js';

export const SCHEMA_VERSION = 2;

export function initSchema(db: Db): void {
  db.exec(
    `
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS character (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT,
      ancestry TEXT,
      class_name TEXT,
      level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
      hp_current INTEGER NOT NULL DEFAULT 0 CHECK (hp_current >= 0),
      hp_max INTEGER NOT NULL DEFAULT 0 CHECK (hp_max >= 0),
      ability_scores_json TEXT NOT NULL DEFAULT '{}',
      conditions_json TEXT NOT NULL DEFAULT '[]',
      provenance TEXT NOT NULL,
      session_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
      location TEXT,
      properties_json TEXT NOT NULL DEFAULT '{}',
      provenance TEXT NOT NULL,
      session_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plot_flags (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      provenance TEXT NOT NULL,
      session_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clock (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      in_game_time TEXT NOT NULL DEFAULT '',
      current_location_id TEXT,
      provenance TEXT NOT NULL,
      session_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS overlay_facts (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      provenance TEXT NOT NULL,
      session_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    `,
  );
  const now = new Date(0).toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO character(id, provenance, session_id, updated_at)
     VALUES (1, ?, ?, ?)`,
  ).run('system:init_schema', 'bootstrap', now);
  db.prepare(
    `INSERT OR IGNORE INTO clock(id, provenance, session_id, updated_at)
     VALUES (1, ?, ?, ?)`,
  ).run('system:init_schema', 'bootstrap', now);
  db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run(
    'schema_version',
    String(SCHEMA_VERSION),
  );
}
