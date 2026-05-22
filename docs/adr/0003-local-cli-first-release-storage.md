# ADR 0003: Local CLI First-Release Storage

Status: superseded by [ADR 0004](0004-config-file-and-campaign-registry.md)

Date: 2026-05-22

> **Superseded.** ADR 0004 replaces the explicit-only storage model below with
> a managed per-user data root, a config file, and a campaign registry. The
> `LOREWEAVER_DB_PATH` explicit path survives as a deliberate advanced option,
> not as the only mechanism. There was no installed user base to migrate.

## Context

The local CLI MVP currently reads campaign and provider configuration from
environment variables. `LOREWEAVER_DB_PATH` is required and names the active
campaign SQLite file. Dolt checkpoints are optional and live beside that file.

Before the first npm CLI release, distribution docs need a concrete storage
decision so users know where Loreweaver writes data and release automation can
smoke the installed command without waiting for a broader config-file or
campaign-picker design.

## Decision

For the first local CLI release, Loreweaver keeps campaign storage explicit.
There is no default per-user app-data root for campaign databases yet.

- Campaign SQLite database: required `LOREWEAVER_DB_PATH`.
- SQLite sidecars: beside the configured campaign database.
- Dolt checkpoint repos: `<LOREWEAVER_DB_PATH>.checkpoints`.
- Checkpoint restore/fork destinations: explicit paths chosen by the command
  or caller.
- Managed Dolt binary cache: `LOREWEAVER_DOLT_HOME` when set, otherwise
  `~/.loreweaver/dolt`.
- Provider secrets: local process environment for the CLI release.
- Config/env templates: repository/package documentation such as
  `.env.example`; the CLI does not auto-load `.env` files.
- Bundled static content: npm package build output, copied into campaign
  tables when a campaign is created.

Platform app-data roots such as `%APPDATA%\Loreweaver`,
`~/Library/Application Support/Loreweaver`, and
`~/.local/share/loreweaver` are deferred until Loreweaver has an explicit
config-file and campaign-selection design.

## Consequences

- The first release has a clear, testable storage model without hidden writes
  to OS-specific app-data directories.
- Users and automation can keep campaign state in a project directory, backup
  directory, synced folder, or other path they choose.
- The CLI remains responsible for actionable config errors when
  `LOREWEAVER_DB_PATH` or provider credentials are missing.
- Future work can add a config file, campaign registry, and per-platform
  app-data defaults without migrating implicit first-release storage.

## Rejected Alternatives

- Choose OS app-data defaults immediately: rejected because the CLI does not
  yet have a campaign picker, config file, or migration story for implicit
  default databases.
- Store provider keys in a local app-data config file for the first release:
  rejected because ADR 0002 keeps local BYOK environment/config ownership
  separate from campaign state, and encrypted local secret storage is not part
  of the first CLI release.
- Bundle Dolt in the npm package: rejected per the CLI distribution plan; Dolt
  remains optional and consent-installed.
