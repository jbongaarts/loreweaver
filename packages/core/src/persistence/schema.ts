import type { Db } from './db.js';

export const SCHEMA_VERSION = 6;

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

    -- E2: immutable campaign template forked from an authored module pack.
    -- These rows are never mutated during play; live divergence is recorded
    -- as overlay_facts and resolved by worldQuery.
    CREATE TABLE IF NOT EXISTS module_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      pack_id TEXT NOT NULL,
      title TEXT NOT NULL,
      pack_type TEXT NOT NULL,
      description TEXT NOT NULL,
      starting_location_id TEXT NOT NULL,
      license_json TEXT NOT NULL,
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS module_location (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      summary TEXT NOT NULL,
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS module_encounter (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      location_id TEXT NOT NULL,
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS module_npc (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      location_id TEXT NOT NULL,
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS module_trigger (
      id TEXT PRIMARY KEY,
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS module_lore (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      scope TEXT NOT NULL,
      data_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS turn_trace (
      campaign_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      consent_scope TEXT NOT NULL,
      player_input TEXT NOT NULL,
      retrieved_context_json TEXT NOT NULL,
      prompt_profile TEXT NOT NULL,
      model_output TEXT NOT NULL,
      tool_calls_json TEXT NOT NULL,
      rules_resolution_json TEXT NOT NULL,
      accepted_state_delta_json TEXT NOT NULL,
      rejected_candidates_json TEXT NOT NULL,
      final_narration TEXT NOT NULL,
      memory_updates_json TEXT NOT NULL,
      human_corrections_json TEXT NOT NULL,
      quality_flags_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (campaign_id, session_id, turn_id)
    );

    CREATE TABLE IF NOT EXISTS scene_summary (
      campaign_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      scene_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      salient_refs_json TEXT NOT NULL,
      source_turn_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (campaign_id, session_id, scene_id)
    );

    CREATE TABLE IF NOT EXISTS session_recap (
      campaign_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      recap TEXT NOT NULL,
      source_scene_ids_json TEXT NOT NULL,
      state_delta_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (campaign_id, session_id)
    );

    CREATE TABLE IF NOT EXISTS arc_summary (
      campaign_id TEXT NOT NULL,
      arc_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      source_session_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (campaign_id, arc_id)
    );

    CREATE TABLE IF NOT EXISTS campaign_bible (
      campaign_id TEXT PRIMARY KEY,
      world_facts_json TEXT NOT NULL,
      major_npcs_json TEXT NOT NULL,
      factions_json TEXT NOT NULL,
      open_threads_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- E5: scene boundaries. Exactly one scene is 'open' per session at a time;
    -- the mark_scene tool closes one before opening the next.
    CREATE TABLE IF NOT EXISTS scene (
      campaign_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      scene_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      PRIMARY KEY (campaign_id, session_id, scene_id)
    );

    -- E5: live per-scene transcript. The Context Assembler feeds the current
    -- scene's log verbatim; older scenes roll up into scene_summary.
    CREATE TABLE IF NOT EXISTS scene_log (
      campaign_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      scene_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      turn_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('player', 'dm')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (campaign_id, session_id, scene_id, seq)
    );

    -- E6: session lifecycle. Graceful close is idempotent; a crash leaves the
    -- session open so launch code can offer resume or close-and-recap.
    CREATE TABLE IF NOT EXISTS campaign_session (
      campaign_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
      started_at TEXT NOT NULL,
      closed_at TEXT,
      PRIMARY KEY (campaign_id, session_id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS campaign_session_one_open
      ON campaign_session(campaign_id)
      WHERE status = 'open';
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
