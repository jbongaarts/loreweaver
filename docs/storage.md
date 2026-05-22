# Local Storage

Loreweaver's first local CLI release uses explicit file paths, as recorded in
[ADR 0003](adr/0003-local-cli-first-release-storage.md). It does not choose a
default per-user app-data directory, and it does not load `.env` files by
itself.

## Active Campaign Database

`LOREWEAVER_DB_PATH` is required. It names the SQLite database file for the
active local campaign:

```powershell
$env:LOREWEAVER_DB_PATH = ".\campaigns\dev.db"
node packages\cli\dist\index.js play
```

`play` opens or creates that database, initializes the schema, forks the
bundled starting module into it when the database has no campaign, and then
stores live campaign state there. The same file is reused when the campaign is
resumed.

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

Bundled or public content must be open-licensed, public domain, original, or
publisher-licensed. Fair use is not the storage or distribution policy.

## Checkpoints

Dolt checkpoints are optional. If no usable `dolt` binary is available, the CLI
still closes and recaps the session without a checkpoint.

When Dolt is available, graceful session close writes a Dolt repo beside the
campaign database:

```text
<LOREWEAVER_DB_PATH>.checkpoints
```

For example, `.\campaigns\dev.db` checkpoints into
`.\campaigns\dev.db.checkpoints`.

Checkpoint restore and fork operations materialize a checkpoint into a new
SQLite database path chosen by the command or caller. Restore refuses to
overwrite an existing destination and builds through a temporary sibling file
before renaming it into place.

Campaign checkpoint repos are separate from beads. The checkpoint store rejects
paths or remotes that collide with the repository's `.beads` Dolt data, and
campaign history must not use the beads-reserved `refs/dolt/data` sync ref.

## Dolt Binary Cache

Loreweaver resolves the Dolt binary in this order:

1. An explicit path from `LOREWEAVER_DOLT_BIN`.
2. The managed Dolt cache directory.
3. A `dolt` executable on `PATH`.

The managed cache defaults to:

```text
~/.loreweaver/dolt
```

Set `LOREWEAVER_DOLT_HOME` to use a different managed cache directory. The CLI
only downloads a managed Dolt binary through `loreweaver dolt install`, and that
command requires interactive consent. Non-interactive shells decline the
download automatically.

## Provider Secrets

**Local dev.** Provider credentials come from the local process environment:
`loadConfig` accepts either `ANTHROPIC_API_KEY` (a Console API key) or
`CLAUDE_CODE_OAUTH_TOKEN` (a Claude Pro/Max subscription token) and resolves a
`ProviderAuth` describing which one is in use. See
[docs/agent-sdk-auth.md](agent-sdk-auth.md). Model profile overrides use
`LOREWEAVER_PROFILE_*_PROVIDER` and `LOREWEAVER_PROFILE_*_MODEL`.

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
- Dolt checkpoints or checkpoint history
- `turn_trace`
- exports
- logs

Hosted BYOK secret handling is a separate design in
[ADR 0002](adr/0002-hosted-web-pwa-byok-deployment-path.md). Hosted keys must
live in a dedicated secret store, not campaign storage.

## First-Release App-Data Decision

The first CLI release intentionally keeps `LOREWEAVER_DB_PATH` required instead
of choosing an implicit OS app-data root such as `%APPDATA%\Loreweaver`,
`~/Library/Application Support/Loreweaver`, or
`~/.local/share/loreweaver`.

That means campaign databases, checkpoint restore destinations, and fork
destinations are explicit user-chosen paths. The managed Dolt binary cache is
the only current per-user default and remains `~/.loreweaver/dolt` unless
`LOREWEAVER_DOLT_HOME` is set. Bundled release content stays in the npm package
build output and is copied into campaign tables when a campaign is created.
