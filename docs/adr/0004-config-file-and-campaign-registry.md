# ADR 0004: Config File and Campaign Registry

Status: proposed

Date: 2026-05-22

## Context

[ADR 0003](0003-local-cli-first-release-storage.md) kept first-release storage
explicit: `LOREWEAVER_DB_PATH` is required and names the single active campaign
SQLite file. ADR 0003 deliberately deferred per-user app-data roots, a config
file, and a campaign registry/picker until a design existed.

That explicit-path model is a usability ceiling:

- A new user must learn an environment variable before the CLI does anything.
- Running a second campaign means editing `LOREWEAVER_DB_PATH`; there is no
  list of campaigns the user already has.
- Non-secret preferences (model profile overrides, Dolt home) are only
  settable through environment variables, which are awkward to persist on
  Windows and easy to lose between shells.

Loreweaver has no released installations. There is no installed user base, no
on-disk data, and no shipped behavior to preserve, so this design specifies the
managed-storage model directly — it carries no migration path or compatibility
constraint. This ADR is the design tracked by beads `loreweaver-d4r.2` under
epic `loreweaver-d4r`; when accepted and implemented it replaces ADR 0003's
explicit-only model.

Provider-secret storage is out of scope: [ADR 0002](0002-hosted-web-pwa-byok-deployment-path.md)
keeps secrets in the environment (local) or a dedicated KMS-backed store
(hosted), and that boundary is unchanged here.

## Decision

Loreweaver's local storage is a managed per-user model with three components.

### 1. Per-user data root

The CLI resolves a single per-user Loreweaver data root:

1. `LOREWEAVER_HOME` when set — an explicit root chosen by the user.
2. Otherwise the per-user default for the platform:
   - Windows: `%LOCALAPPDATA%\Loreweaver`
     (e.g. `C:\Users\<name>\AppData\Local\Loreweaver`)
   - macOS and Linux: `~/.loreweaver`

Both defaults are per-user, not machine-wide. On Windows, `%LOCALAPPDATA%`
(`AppData\Local`) is the canonical per-user, non-roaming application-data
location; it is preferred over `%APPDATA%` (`AppData\Roaming`) because campaign
SQLite databases and the cached Dolt binary are large and machine-specific and
must not be synced by roaming profiles. A home-directory dotfolder is the
matching idiomatic per-user location on macOS and Linux, and it is already
where the managed Dolt cache lives (`~/.loreweaver/dolt`); a bare dotfolder in
`%USERPROFILE%` is a Unix idiom rather than the Windows convention, so Windows
uses its native `%LOCALAPPDATA%` location instead.

The root contains:

```text
<root>/
  config.json         # non-secret CLI preferences
  registry.json       # known-campaign index
  campaigns/          # managed campaign SQLite databases (and sidecars)
  dolt/               # managed Dolt binary cache
```

The managed Dolt cache is `<root>/dolt` — `~/.loreweaver/dolt` on macOS and
Linux (unchanged from current behavior) and `%LOCALAPPDATA%\Loreweaver\dolt` on
Windows. `LOREWEAVER_DOLT_HOME` overrides that location.

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

Environment variables outrank the config file so scripted and CI invocations
can pin a value without editing per-user state.

The CLI does not auto-load `.env` files; that ADR 0003 position is unchanged.

### 3. Campaign registry and picker

`<root>/registry.json` is a small index of campaigns the CLI manages. Each
entry records non-content metadata only:

- stable campaign id (slug)
- display name
- database path (under `<root>/campaigns/` for managed campaigns, or an
  absolute path for an externally located database)
- created-at and last-played-at timestamps
- module / rules-pack identity used to create it

The registry stores **pointers and metadata, never campaign content or
secrets.** It is written with the atomic temp-file-plus-rename pattern already
used by checkpoint restore, so a crash mid-write cannot corrupt it.

CLI behavior, the default path:

- `loreweaver new` creates `campaigns/<slug>.db`, forks the starting module
  into it, and registers the entry.
- `loreweaver play` with no campaign argument: if the registry is empty it
  offers to create the first campaign; if it has one entry it opens that one;
  if it has several it shows a picker (honoring `defaultCampaignId`).
- `loreweaver campaigns list | rename | remove | add <path>` manage entries.
  `remove` unregisters and does not delete the database file unless asked;
  `add` registers a database that lives outside `<root>/campaigns/`.

### Explicit-path campaigns

`LOREWEAVER_DB_PATH` is kept as a deliberate explicit-path option for scripted,
CI, and power-user workflows — project directories, backup directories, and
synced folders. When it is set the CLI opens exactly that database and does not
register it; the campaign is unmanaged by design. A user who later wants such a
database managed runs `loreweaver campaigns add <path>`. This is a chosen
feature of the storage model, not a compatibility shim.

`loreweaver-d4r.2` only commits this design. Implementation is split into
follow-up beads under epic `loreweaver-d4r`.

## Consequences

- A new user can run `loreweaver` and create or pick a campaign without first
  learning an environment variable.
- The managed registry is the default; the explicit `LOREWEAVER_DB_PATH` path
  is a deliberate advanced option, so project-directory, backup-directory, and
  synced-folder workflows remain available.
- New code is required: per-platform root resolution, config-file load/validate
  with the documented precedence, registry read/write with atomic writes, and
  picker UX. None of it touches `@loreweaver/core` orchestration.
- Secrets stay out of managed storage: `config.json` is non-secret and is
  validated to reject key-shaped values; ADR 0002's secret boundary is intact.
- One Loreweaver directory per user (config, registry, managed campaigns, Dolt
  cache) makes the storage model easy to document, back up, and delete.
- When accepted and implemented this ADR supersedes ADR 0003: the explicit-only
  first-release model is replaced outright, with no migration step because no
  installations exist. ADR 0003 should be marked superseded at that point, and
  `docs/storage.md` and `docs/cli-distribution.md` updated to the managed
  model.

## Rejected Alternatives

- **`%APPDATA%` (Roaming) on Windows:** rejected in favor of `%LOCALAPPDATA%`
  (Local) — campaign databases and the cached Dolt binary are large and
  machine-specific, and roaming profiles should not sync them.
- **`~/Library/Application Support` / `$XDG_DATA_HOME` on macOS and Linux:**
  rejected in favor of `~/.loreweaver` — a single home-directory dotfolder is
  unambiguously user-level, easy to find and back up, and matches the existing
  Dolt cache path. Windows still uses its canonical `%LOCALAPPDATA%` location
  because a bare dotfolder in `%USERPROFILE%` is a Unix idiom, not the Windows
  convention.
- **TOML for the config file:** rejected — it would add a parser dependency to
  an intentionally lean CLI, and the registry is JSON regardless; one
  serialization keeps the storage code minimal.
- **Storing provider secrets in `config.json`:** rejected per ADR 0002 — local
  secrets stay in the environment; encrypted local secret storage is a
  separate future decision.
- **Backing the registry with SQLite or Dolt:** rejected — the registry is a
  handful of pointer records; a JSON file with atomic writes avoids another
  schema, migration story, and the beads/`refs/dolt/data` separation concerns.
- **Removing `LOREWEAVER_DB_PATH` entirely:** rejected — an explicit-path
  option is genuinely useful for CI smoke tests and synced-folder workflows;
  it is kept as a deliberate feature, distinct from the managed default.
