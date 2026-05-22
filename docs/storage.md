# Local Storage

Loreweaver keeps one managed directory per user — the **data root** — holding
the config file, the campaign registry, managed campaign databases, installed
rules packs, and the managed Dolt binary cache. The model is recorded in
[ADR 0004](adr/0004-config-file-and-campaign-registry.md). The CLI does not load
`.env` files by itself.

## Per-User Data Root

Loreweaver resolves one data root per user:

1. `LOREWEAVER_HOME`, when set.
2. Otherwise the platform default: `%LOCALAPPDATA%\Loreweaver` on Windows,
   `~/.loreweaver` on macOS and Linux.

The root contains:

```text
<root>/
  config.json     non-secret CLI preferences
  registry.json   the campaign registry
  campaigns/      managed campaign databases and their sidecars
  rules-packs/    installed (non-bundled) RPG rules packs
  dolt/           the managed Dolt binary cache
```

The root and its subdirectories are created lazily — only on a command that
writes managed data, never on a bare `loreweaver` banner run.

### Config File

`config.json` holds non-secret preferences only: `defaultCampaignId`,
`doltHome`, `doltBin`, and per-profile `profiles` overrides. Settings
precedence, highest first: explicit CLI flag, environment variable,
`config.json`, built-in default. The CLI rejects a `config.json` that contains
a provider-key-shaped value or a secret-named key — credentials belong in the
environment, never in the config file (see [Provider Secrets](#provider-secrets)).

## Campaigns

Each campaign is a single SQLite database. The CLI manages campaigns through a
registry (`registry.json`) of pointer metadata — id, display name, database
path, timestamps, and the module identity — and never campaign content:

- `loreweaver new <name>` creates `campaigns/<slug>.db` under the data root,
  forks the bundled starting module into it, and registers it.
- `loreweaver play` opens a campaign: it plays the only registered campaign
  directly, shows a picker when several exist, or offers to create the first
  one when the registry is empty. `loreweaver play <id>` opens one by id.
- `loreweaver campaigns list | rename | remove | add` manage the registry.
  `remove` unregisters a campaign without deleting its database file; `add`
  registers a database that lives outside `campaigns/`.

`play` opens or creates the database, initializes the schema, forks the bundled
starting module when the database has no campaign, and stores live campaign
state there. The same file is reused when the campaign is resumed.

`LOREWEAVER_DB_PATH` overrides all of this: when it is set the CLI opens exactly
that database as an explicit, unmanaged campaign and does not consult the
registry. It suits scripted, CI, and synced-folder workflows.

SQLite may create transient sidecar files beside the database while it is open,
such as `dev.db-wal`, `dev.db-shm`, or `dev.db-journal`. Treat those as part of
the live local working copy, not as separate Loreweaver stores.

## Bundled Static Content

Static content ships with the package source/build output:

- `EMBERFALL_HOLLOW` is the bundled sample module currently forked into new
  campaigns by the CLI.
- The SRD catalog and license metadata are bundled in the core package.

When a new campaign is created, module template records are copied into
immutable `module_*` tables in the campaign SQLite database. Later play writes
live changes and overlays into live campaign tables; it does not mutate the
pack source.

Non-bundled rules packs (other RPG systems, publisher-licensed packs) install
under `<root>/rules-packs/`; that directory is reserved by ADR 0004 and stays
empty until the multiple-rules-pack work ships. Unlike module content, rules
data is not copied into campaign databases — lookups resolve against the active
pack at runtime.

Bundled or public content must be open-licensed, public domain, original, or
publisher-licensed. Fair use is not the storage or distribution policy.

## Checkpoints

Dolt checkpoints are optional. If no usable `dolt` binary is available, the CLI
still closes and recaps the session without a checkpoint.

When Dolt is available, graceful session close writes a Dolt repo beside the
campaign database, at `<dbPath>.checkpoints`. For example, a campaign database
`dev.db` checkpoints into `dev.db.checkpoints`.

Checkpoint restore and fork operations materialize a checkpoint into a new
SQLite database path chosen by the command or caller. Restore refuses to
overwrite an existing destination and builds through a temporary sibling file
before renaming it into place.

Campaign checkpoint repos are separate from beads. The checkpoint store rejects
paths or remotes that collide with the repository's `.beads` Dolt data, and
campaign history must not use the beads-reserved `refs/dolt/data` sync ref.

## Dolt Binary Cache

Loreweaver resolves the Dolt binary in this order:

1. An explicit path from `LOREWEAVER_DOLT_BIN` (or `doltBin` in `config.json`).
2. The managed Dolt cache directory.
3. A `dolt` executable on `PATH`.

The managed cache defaults to `<root>/dolt` — `~/.loreweaver/dolt` on macOS and
Linux, `%LOCALAPPDATA%\Loreweaver\dolt` on Windows. Set `LOREWEAVER_DOLT_HOME`
(or `doltHome` in `config.json`) to use a different managed cache directory. The
CLI only downloads a managed Dolt binary through `loreweaver dolt install`, and
that command requires interactive consent. Non-interactive shells decline the
download automatically.

## Provider Secrets

**Local dev.** Provider credentials come from the local process environment:
`loadConfig` accepts either `ANTHROPIC_API_KEY` (a Console API key) or
`CLAUDE_CODE_OAUTH_TOKEN` (a Claude Pro/Max subscription token) and resolves a
`ProviderAuth` describing which one is in use. See
[docs/agent-sdk-auth.md](agent-sdk-auth.md). Model profile overrides use
`LOREWEAVER_PROFILE_*_PROVIDER` and `LOREWEAVER_PROFILE_*_MODEL`. Secrets are
never read from or written to `config.json`.

**Auth-injection seam.** The Agent SDK adapter (`AgentSdkModelClient`) does not
rely on the SDK silently reading ambient `process.env`. It exposes an explicit
auth seam — an `AgentSdkAuthSource`, a fixed `{ env }` value or a function
resolved per `complete()` call. The CLI passes the key validated by
`loadConfig` through this seam; the secret is forwarded only into the SDK
process environment and is held in an ECMAScript-private field, so a client
object captured into a trace or log cannot leak it.

**Hosted BYOK.** A hosted deployment supplies each request its own provider
secret through the same seam — sourced from a dedicated secret store, never
ambient process state — so per-tenant keys and short-lived/rotating credentials
need no code change in the adapter. The function form of `AgentSdkAuthSource`
covers per-request secrets.

Provider secrets must not be written to:

- campaign SQLite databases
- the config file or campaign registry
- Dolt checkpoints or checkpoint history
- `turn_trace`
- exports
- logs

Hosted BYOK secret handling is a separate design in
[ADR 0002](adr/0002-hosted-web-pwa-byok-deployment-path.md). Hosted keys must
live in a dedicated secret store, not campaign storage.
