# ADR 0004: Config File and Campaign Registry

Status: proposed

Date: 2026-05-22

## Context

[ADR 0003](0003-local-cli-first-release-storage.md) kept first-release storage
explicit: `LOREWEAVER_DB_PATH` is required and names the single active campaign
SQLite file. ADR 0003 deliberately deferred per-user app-data roots, a config
file, and a campaign registry/picker until a design existed, so the first npm
CLI release would have no hidden writes to OS-specific directories.

That explicit-path model is a usability ceiling, not a permanent shape:

- A new user must learn an environment variable before the CLI does anything.
- Running a second campaign means editing `LOREWEAVER_DB_PATH`; there is no
  list of campaigns the user already has.
- Non-secret preferences (model profile overrides, Dolt home) are only
  settable through environment variables, which are awkward to persist on
  Windows and easy to lose between shells.

This ADR is the deferred design (beads `loreweaver-d4r.2`, epic
`loreweaver-d4r`). It fixes *where* managed data lives, *what* the config file
holds, and *how* campaigns are registered and selected — without regressing the
ADR 0003 explicit-path behavior that release smoke tests and CI depend on.

It does not cover provider-secret storage: [ADR 0002](0002-hosted-web-pwa-byok-deployment-path.md)
keeps secrets in the environment (local) or a dedicated KMS-backed store
(hosted), and that boundary is unchanged here.

## Decision

Loreweaver gains three managed-storage components. All three are **opt-in by
absence of `LOREWEAVER_DB_PATH`**: when that variable is set, the CLI behaves
exactly as ADR 0003 specifies and ignores the registry entirely.

### 1. Per-user data root

The CLI resolves a single Loreweaver data root, in this precedence order:

1. `LOREWEAVER_HOME` when set — an explicit root chosen by the user.
2. Otherwise the per-platform default:
   - Windows: `%APPDATA%\Loreweaver`
   - macOS: `~/Library/Application Support/Loreweaver`
   - Linux/other: `$XDG_DATA_HOME/loreweaver`, falling back to
     `~/.local/share/loreweaver`

The root contains:

```text
<root>/
  config.json         # non-secret CLI preferences
  registry.json       # known-campaign index
  campaigns/          # managed campaign SQLite databases (and sidecars)
  dolt/               # managed Dolt binary cache
```

The managed Dolt cache moves under this root (`<root>/dolt`) so there is one
Loreweaver directory per user. `LOREWEAVER_DOLT_HOME` still overrides it and,
for compatibility, an existing `~/.loreweaver/dolt` cache is still honored when
present; the new default only applies to fresh installs.

The CLI creates the root and its subdirectories lazily, on the first command
that needs to write managed data — never on a plain `loreweaver` banner run.

### 2. Config file

`<root>/config.json` holds **non-secret** preferences only. JSON is used (not
TOML) to avoid a new dependency and to match `registry.json`; the registry is
JSON regardless, and a single serialization keeps the read/write code small.

Recognized keys (all optional):

- `defaultCampaignId` — campaign selected by `play` when none is given.
- `profiles` — model profile overrides equivalent to `LOREWEAVER_PROFILE_*`.
- `doltHome` / `doltBin` — equivalents of `LOREWEAVER_DOLT_HOME` /
  `LOREWEAVER_DOLT_BIN`.

Provider credentials are **never** written to `config.json`. The CLI rejects a
config file that contains an API-key-shaped value, to fail loud if a user
pastes a secret there by mistake.

Settings precedence, highest wins:

```text
explicit CLI flag  >  environment variable  >  config.json  >  built-in default
```

Environment variables intentionally outrank the config file so existing
scripted and CI usage keeps working unchanged after the config file ships.

The CLI does not auto-load `.env` files; that ADR 0003 position is unchanged.

### 3. Campaign registry and picker

`<root>/registry.json` is a small index of campaigns the CLI manages. Each
entry records non-content metadata only:

- stable campaign id (slug)
- display name
- database path (under `<root>/campaigns/` for managed campaigns, or an
  absolute path for an adopted external database)
- created-at and last-played-at timestamps
- module / rules-pack identity used to create it

The registry stores **pointers and metadata, never campaign content or
secrets.** It is written with the atomic temp-file-plus-rename pattern already
used by checkpoint restore, so a crash mid-write cannot corrupt it.

CLI behavior when `LOREWEAVER_DB_PATH` is *not* set:

- `loreweaver new` creates `campaigns/<slug>.db`, forks the starting module
  into it, and registers the entry.
- `loreweaver play` with no campaign argument: if the registry is empty it
  offers to create the first campaign; if it has one entry it opens that one;
  if it has several it shows a picker (honoring `defaultCampaignId`).
- `loreweaver campaigns list | rename | remove | add <path>` manage entries.
  `remove` unregisters and does not delete the database file unless asked;
  `add` adopts an existing explicit-path database into the registry.

`loreweaver-d4r.2` only commits this design. Implementation is split into
follow-up beads under epic `loreweaver-d4r`.

### Backward compatibility and migration

- `LOREWEAVER_DB_PATH` remains supported indefinitely as the explicit,
  unmanaged path. When set it takes precedence, the registry and picker are
  bypassed, and ADR 0003 behavior is exact — so the release smoke test and CI
  keep passing without change.
- There is no implicit relocation of existing databases. First run after the
  registry ships simply creates an empty `registry.json`.
- A user with an ADR 0003 explicit-path campaign adopts it deliberately with
  `loreweaver campaigns add <path>`; the database is not moved, only indexed.
- The managed Dolt cache default moves to `<root>/dolt`, but an existing
  `~/.loreweaver/dolt` is still detected, so no checkpoint cache is orphaned.

## Consequences

- A new user can run `loreweaver` and create or pick a campaign without first
  learning an environment variable.
- ADR 0003's explicit-path mode is retained as the advanced/unmanaged path, not
  replaced; this preserves project-directory, backup-directory, and synced-
  folder workflows and every existing test.
- New code is required: per-platform root resolution, config-file load/validate
  with the documented precedence, registry read/write with atomic writes, and
  picker UX. None of it touches `@loreweaver/core` orchestration.
- Secrets stay out of managed storage: `config.json` is non-secret and is
  validated to reject key-shaped values; ADR 0002's secret boundary is intact.
- One Loreweaver directory per user (config, registry, managed campaigns, Dolt
  cache) makes the storage model easy to document, back up, and delete.
- `docs/storage.md` and `docs/cli-distribution.md` will need updates once the
  implementation lands; this ADR supersedes only the *deferral* recorded in
  ADR 0003, not ADR 0003's explicit-path decision.

## Rejected Alternatives

- **Separate XDG config and data directories on Linux** (`$XDG_CONFIG_HOME`
  vs `$XDG_DATA_HOME`): rejected for this iteration — a single
  `LOREWEAVER_HOME` root is simpler, consistent across all three platforms,
  and easy to document and remove. It can be revisited if Linux packaging
  needs strict XDG compliance.
- **TOML for the config file:** rejected — it would add a parser dependency to
  an intentionally lean CLI, and the registry is JSON regardless; one
  serialization keeps the storage code minimal.
- **Storing provider secrets in `config.json`:** rejected per ADR 0002 — local
  secrets stay in the environment; encrypted local secret storage is a
  separate future decision.
- **Auto-migrating existing explicit-path databases into the managed root:**
  rejected — silently moving a user's database is surprising and risks
  breaking their own scripts; explicit `campaigns add` adoption is safer.
- **Backing the registry with SQLite or Dolt:** rejected — the registry is a
  handful of pointer records; a JSON file with atomic writes avoids another
  schema, migration story, and the beads/`refs/dolt/data` separation concerns.
- **Dropping `LOREWEAVER_DB_PATH`:** rejected — it would break CI, the release
  smoke test, and scripted/power-user workflows that ADR 0003 deliberately
  supports.
