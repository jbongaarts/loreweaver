# Semantic Dolt Checkpoint Projection (Design / Deferred)

Status: **planned, not scheduled.** This document designs an optional semantic
projection layer for campaign checkpoints. It is deliberately **not** an
implementation commitment. Build it only when a concrete near-term history UX
("what changed between these two checkpoints?", a campaign timeline, a diff
view) needs it. Until then the restore-safe snapshot format below remains the
sole checkpoint authority and nothing in this document should be implemented.

Tracking: `eshyra-0jq.15` (parent epic `eshyra-0jq`). Builds on the
`DoltCli` / `DoltRepo` split from `eshyra-0jq.14`.

## Problem

Today a checkpoint is one Dolt table, `campaign_snapshot`, written by
`DoltRepo.applySnapshot` (`packages/core/src/persistence/checkpoint/doltRepo.ts`):

```sql
CREATE TABLE campaign_snapshot (
  tbl VARCHAR(255), kind VARCHAR(16), ordinal INT, payload LONGTEXT,
  PRIMARY KEY (tbl, kind, ordinal)
);
```

`serializeCampaign` (`serialize.ts`) walks every campaign table dynamically,
emits one `schema` record per table (the `CREATE` statement) and one `row`
record per row. Each row is canonicalized — keys sorted, blobs base64-tagged —
into an opaque JSON string in `payload`, and the rows for a table are sorted by
that string and assigned a positional `ordinal`.

This is exactly right for **restore and fork correctness**: it is
schema-agnostic, survives schema changes, round-trips blobs, and rebuilds a
byte-faithful SQLite database (`store.ts::materialize`). It is wrong for
**semantic diffs** for three reasons:

1. **Everything lives in one table.** Dolt can diff `campaign_snapshot` between
   two commits, but every entity in the entire campaign is collapsed into
   `(tbl, kind, ordinal, payload)`. A diff shows "row N of `character` changed"
   not "Aria's `hp_current` went 12 → 4".
2. **The primary key is positional, not identity-based.** `ordinal` is assigned
   after sorting the canonical JSON of each row. Change one field of one
   character and its canonical string changes, which can move its sort position,
   which renumbers `ordinal` for it and possibly its neighbours. Dolt then sees
   a cascade of changed rows where one logical entity changed. Inserts/deletes
   shift ordinals for every following row in that table.
3. **The payload is opaque to Dolt.** `payload` is a JSON blob. Dolt diffs it as
   a single string column, so even when it does pin the right row, the "diff" is
   two JSON blobs, not field-level deltas.

Net: `dolt diff <a> <b>` over the current format is technically available but
produces noise, not a campaign-meaningful changelog.

## Goal and non-goals

**Goal.** Make checkpoint-to-checkpoint history answerable at the level a player
or DM cares about — character vitals, inventory, plot flags, location/time,
scene/arc/session progression — without weakening restore.

**Non-goals.**

- Replacing or modifying the snapshot format. `campaign_snapshot` stays the
  restore/fork authority. The projection is read-only sugar.
- Per-turn history. The per-turn store is SQLite; `turn_trace` already records
  turn-level provenance. Checkpoints are coarse (session-close granularity), so
  the projection is a coarse timeline, not a turn log.
- A diff UI. This designs the data layer a UI would read; the UI is separate
  scope.
- Touching the beads Dolt repo or its sync ref. The separation guarantees in
  `separation.ts` (`assertSeparateFromBeads`, `refs/dolt/data`) continue to
  hold; the projection lives inside the campaign checkpoint repo only.

## Which entities are worth projecting

Campaign tables fall into four classes (see the header comment in `schema.ts`).
Their diff value differs sharply:

| Class | Tables | Project? | Why |
|-------|--------|----------|-----|
| **Live mutable state** | `character`, `inventory`, `plot_flags`, `clock`, `overlay_facts`, `scene`, `campaign_session`, `campaign_arc`, `campaign_rules_binding`, `meta` | **Yes (high value)** | These are exactly "what changed in the campaign". Stable identity keys, small, frequently mutated. |
| **Immutable module template** | `module_meta`, `module_location`, `module_encounter`, `module_npc`, `module_trigger`, `module_lore` | **No** | Read-only post-fork. They never change between checkpoints of one campaign, so a projection would be all churn-free noise and pure storage cost. |
| **Generated / archival memory** | `turn_trace`, `scene_summary`, `session_recap`, `arc_summary`, `campaign_bible`, `scene_log` | **Mostly no; selective** | Append-only logs. A diff is just "new rows appended", which a `COUNT`/`MAX(created_at)` summary captures more cheaply than a full projection. `campaign_bible` is the one exception worth a thin projection — it is overwritten in place and its fields (open threads, factions) are a meaningful campaign-state diff. |
| **Operational diagnostics** | `turn_failure_diagnostic` | **No** | Non-canon debugging records, explicitly not game history. |

Recommended first projection set (the high-value, low-volume, identity-stable
core):

- `character` — vitals (`hp_current`, `hp_max`, `level`), `conditions_json`,
  `ability_scores_json`, name/ancestry/class. The single most diff-worthy entity.
- `inventory` — gains/losses/quantity/location, keyed by `id` with
  `character_id`.
- `plot_flags` — keyed by `key`; the canonical "story state" toggles.
- `clock` — singleton; `in_game_time` and `current_location_id` movement.
- `overlay_facts` — keyed by `key`; live divergence from module canon.
- `scene` / `campaign_session` / `campaign_arc` — lifecycle/progression
  (status transitions, open/close timestamps).
- `campaign_bible` (thin) — `open_threads_json`, `factions_json` deltas.

Defer `meta` and `campaign_rules_binding` to a second pass — useful but rarely
changing; cheap to add later.

## Design

### Shape: one native Dolt table per projected entity, in the same repo

Alongside `campaign_snapshot`, materialize one Dolt table per projected entity,
mirroring the SQLite columns with native typed columns and the entity's real
primary key — **not** a positional ordinal. For example:

```sql
CREATE TABLE proj_character (
  id VARCHAR(255) PRIMARY KEY,
  name LONGTEXT, ancestry LONGTEXT, class_name LONGTEXT,
  level INT, hp_current INT, hp_max INT,
  ability_scores_json LONGTEXT, conditions_json LONGTEXT,
  role VARCHAR(16), session_id LONGTEXT, updated_at LONGTEXT
  -- provenance intentionally omitted; see "What to omit"
);

CREATE TABLE proj_plot_flags (
  `key` VARCHAR(255) PRIMARY KEY,
  value_json LONGTEXT, session_id LONGTEXT, updated_at LONGTEXT
);
```

Because the primary key is the entity's identity, Dolt's diff engine pins each
logical entity across commits and reports **field-level** deltas:
`dolt diff <a> <b> proj_character` shows precisely which character's which column
changed. Inserts and deletes are real adds/removes, not ordinal cascades.

These `proj_*` tables are committed in the **same Dolt commit** as the snapshot,
so a checkpoint is atomic: snapshot + projection always agree, and
`dolt_log` / commit hashes already returned by `DoltRepo.log()` are the timeline
the projection diffs against. No second history, no second commit graph.

### Why same-repo native tables (over the alternatives)

- **vs. keeping it all in `campaign_snapshot`:** rejected — that is the status
  quo whose opacity is the problem.
- **vs. a separate Dolt repo for projections:** rejected — doubles the commit
  graph, risks drift between snapshot and projection, and complicates the
  `assertSeparateFromBeads` story. One repo, one commit, atomic.
- **vs. JSON-per-row but in per-entity tables:** rejected — still opaque to
  Dolt's column differ; native columns are the whole point.
- **vs. computing diffs in TypeScript from two restored SQLite copies:** viable
  as a *fallback* if we never want extra Dolt tables (restore both checkpoints
  to temp DBs, diff in code). Cheaper to ship, but throws away Dolt's native,
  indexed, branchable diff and scales O(rows) in app code per query. Keep as the
  zero-projection escape hatch, not the primary design.

### Schema handling and column drift

The projection schema must track the SQLite schema (currently `SCHEMA_VERSION`
in `schema.ts`). Two options:

1. **Generated projection schema (recommended).** Derive `proj_*` `CREATE`
   statements from the same table metadata `serializeCampaign` already reads
   (`sqlite_master` / `PRAGMA table_info`), via an explicit allowlist of
   projected tables and a SQLite→Dolt type map. New columns flow in
   automatically; new *tables* are projected only when added to the allowlist.
   This keeps projection from silently diverging when the schema migrates.
2. **Hand-written projection schema.** Simpler to read, but a standing migration
   liability — every `schema.ts` change risks a stale projection. Rejected as
   the default.

Either way, the projection is rebuilt wholesale at each checkpoint (drop +
recreate + insert, exactly as `applySnapshot` does for the snapshot today), so
there is no projection-side migration framework to maintain — the *current*
schema's projection is regenerated every commit, and history is preserved by
Dolt's commit graph rather than by in-place projection migration.

### What to omit from projections

- **`provenance` / bootstrap noise:** omit `provenance` and similar
  write-bookkeeping columns from projections — they add diff churn without
  campaign meaning. (Keep them in the snapshot; that is the authority.)
- **Secrets:** the projection is checkpoint history and is bound by the same
  rule as the snapshot — no provider secrets, ever (see `docs/storage.md`
  "Provider Secrets"). Since the projected tables are a strict subset of live
  state columns and live state never holds secrets, this is preserved by
  construction; assert it in tests anyway.
- **Large opaque blobs:** for `campaign_bible` and any selectively-projected
  generated table, project only the human-meaningful JSON fields, not the full
  trace payloads.

## Integration points

- **Write path:** extend `DoltRepo` (or a sibling `ProjectionWriter` it
  delegates to) with `applyProjection(records | db)` called from
  `CheckpointStore.checkpoint` *between* `applySnapshot` and `commit`, so both
  land in one commit. `serializeCampaign` can stay as-is; the projection writer
  can read the same `Db` directly (typed columns) rather than the canonical JSON.
- **Read path (new, optional):** a `CheckpointStore.diff(aId, bId)` that shells
  `dolt diff -r json <a> <b> <proj_table…>` through `DoltCli` and maps the
  result to a typed `CampaignDiff`. This is the API a future timeline/diff UI
  consumes. It does not exist until the UX needs it.
- **Restore path:** unchanged. `readSnapshotAt` / `materialize` read only
  `campaign_snapshot`. The projection is never read during restore.
- **Availability:** projections are as optional as checkpoints themselves. With
  no `dolt` binary there are no checkpoints and therefore no projections; the
  session still closes and recaps.

## Cost and risk

- **Storage:** the projection roughly doubles per-checkpoint row storage for the
  projected (small, live-state) tables only — module/template and trace tables
  are excluded, which is the bulk. Acceptable; Dolt stores deltas.
- **Write latency:** one extra `dolt sql` batch per checkpoint. Checkpoints are
  session-close events, not per-turn, so latency is not on the hot path.
- **Maintenance:** the real cost is keeping the projection schema in step with
  `schema.ts`. The generated-schema approach (option 1 above) plus a test that
  asserts every allowlisted table's projected columns exist contains this.
- **Reversibility:** because the snapshot remains the sole restore authority, the
  projection can be dropped entirely (stop writing `proj_*`) with zero impact on
  restore/fork. This keeps the feature genuinely optional and low-risk to trial.

## Recommended sequencing (when this is picked up)

1. Land the generated projection-schema helper (SQLite→Dolt type map + table
   allowlist) and unit-test it against the live schema, **schema only, no diff
   UX** — proves the projection stays in step with `schema.ts`.
2. Write `proj_character` + `proj_plot_flags` + `proj_clock` in the checkpoint
   commit; assert atomicity and no-secret invariants.
3. Add the remaining live-state tables and the thin `campaign_bible` projection.
4. Only then add `CheckpointStore.diff` and a typed `CampaignDiff`, driven by an
   actual history UX bead.

Steps 1–3 are inert (extra tables nobody reads). Step 4 is the first
user-visible change and should not start without a consuming UX requirement,
per this document's deferral.
