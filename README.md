# Loreweaver

**A text-first, persistent AI Dungeon Master for long-running fantasy campaigns.**

Loreweaver is not a generic fantasy chatbot and not a virtual tabletop. It is a
campaign engine that preserves canon across many play sessions: it remembers
prior events, tracks structured game state, adjudicates rules through
deterministic tools, and sustains a tabletop-like solo or small-group
experience entirely through text.

It is built for two overlapping kinds of player:

- **Tabletop-seeking solo adventurers** who want D&D/TTRPG-style play when
  friends are unavailable or nobody wants to DM.
- **Living text-world nostalgists** who loved text adventures, MUDs, and BBS
  door games but wanted worlds that could understand actions the designer
  never pre-authored.

The promise: open-ended text adventure plus tabletop rules and consequences
plus persistent campaign memory. It should feel like a real DM inhabiting a
living world, not a video game missing its graphics.

> **Project status:** local CLI MVP. The repository now contains the
> provider-neutral core, SQLite persistence, module/world loading, SRD-backed
> rules lookup, deterministic tools, model orchestration, session launch/resume,
> graceful session close, and optional Dolt checkpoints. The CLI can create or
> resume a local campaign and run interactive model-backed turns. The project is
> still pre-distribution: packaging, release workflow, and default user data
> locations are being planned after the MVP epic.

## Why It's Built This Way

- **Text-first.** The MVP is pure text: narration, player input, dice/results,
  state tracking, campaign memory, summaries, checkpoints, and
  theater-of-the-mind combat. Structured UI panels, tactical abstractions, and
  VTT export come later; native VTT and native mobile are explicit non-goals
  for early scope.
- **CLI now, web later.** The current surface is CLI/local-friendly because it
  is the fastest route to the core game loop, local campaign state, and
  bring-your-own-key use. The likely public product is a hosted,
  mobile-friendly web app / PWA. The CLI remains supported as the local and
  power-user surface.
- **Provider-neutral core.** Model access is isolated behind provider adapters
  and capability-based model profiles such as `premium_dm`, `state_extractor`,
  and `summarizer`. The Claude Agent SDK is the initial adapter, not a hardcoded
  core assumption.
- **Premium quality floor.** The primary DM targets frontier-model quality
  (Opus 4.6+ / GPT-5.5-class or a future equivalent). Cheaper models are only
  for bounded auxiliary tasks that cannot corrupt canon. Loreweaver targets a
  capability floor, not a price floor.
- **Separated knowledge.** Rules/mechanics, campaign/module content, live
  campaign state, user-private content, and generated memory are kept separate.
  Bundled/public content must be open-licensed, public domain, original, or
  publisher-licensed; fair use is not the permission model.

See [docs/architecture-report.md](docs/architecture-report.md) for the full
strategy,
[docs/adr/0001-product-model-deployment-content-strategy.md](docs/adr/0001-product-model-deployment-content-strategy.md)
for the product/model/content decision record, and
[docs/adr/0002-hosted-web-pwa-byok-deployment-path.md](docs/adr/0002-hosted-web-pwa-byok-deployment-path.md)
for the CLI-to-hosted deployment path. The local CLI release plan is in
[docs/cli-distribution.md](docs/cli-distribution.md).

## Repository Layout

Monorepo using npm workspaces:

| Package            | Path             | Role                                                    |
| ------------------ | ---------------- | ------------------------------------------------------- |
| `@loreweaver/core` | `packages/core`  | UI-agnostic engine: config, models, tools, persistence  |
| `@loreweaver/cli`  | `packages/cli`   | Thin CLI front end for local play and development       |

## Getting Started

### Prerequisites

- **Node.js 22 LTS recommended.** CI pins Node 22 for the native
  `better-sqlite3` dependency. Local Node 24 may work when a compatible native
  binding is available, but Node 22 is the supported baseline.
- **Anthropic API key.** The only concrete model adapter today is the Claude
  Agent SDK adapter.
- **Dolt optional.** Dolt is used only for local campaign checkpoints on
  graceful session close. Play still works without Dolt; the CLI reports that
  the session was closed without a checkpoint.

### Install The CLI

After the CLI packages are published, install the command with npm:

```bash
npm install -g @loreweaver/cli
loreweaver
```

That command prints the core version and resolved config. If required
configuration is missing, it prints the missing setting instead of requiring a
repository checkout or a direct `node packages/cli/dist/index.js` invocation.

### Build From Source

```bash
npm install        # local install
npm run build      # tsc --build (incremental)
npm run typecheck  # tsc --build --force (full deterministic build)
npm run test       # vitest run
```

Use `npm ci` for clean CI-style installs and `npm run clean` before any proof
that needs fresh build output. Incremental TypeScript builds can otherwise
report "up to date" after `dist/` was deleted if `.tsbuildinfo` remains.

## Configuration

The CLI reads configuration from environment variables. `.env.example` is a
template, but the CLI does not currently load `.env` files by itself.

Required:

- `LOREWEAVER_DB_PATH` - SQLite database file for the active local campaign.
- `ANTHROPIC_API_KEY` - API key used by the Claude Agent SDK adapter.

Optional:

- `LOREWEAVER_MODEL` - Claude model id for the current flat config path.
- `LOREWEAVER_PROFILE_*_PROVIDER` / `LOREWEAVER_PROFILE_*_MODEL` - per-profile
  provider/model overrides for the provider-neutral profile registry.
- `LOREWEAVER_DOLT_BIN` - explicit path to a Dolt binary for checkpoints.
- `LOREWEAVER_DOLT_HOME` - managed Dolt cache directory used by
  `loreweaver dolt install`; defaults to `~/.loreweaver/dolt`.

Installed CLI PowerShell example:

```powershell
$env:LOREWEAVER_DB_PATH = ".\campaigns\dev.db"
$env:ANTHROPIC_API_KEY = "sk-ant-..."
loreweaver play
```

## CLI Usage

After install, run the CLI with:

```bash
loreweaver
```

This prints the core version and resolved config.

Start or resume a campaign:

```bash
loreweaver play
```

`play` opens or creates the SQLite database at `LOREWEAVER_DB_PATH`, forks the
bundled `EMBERFALL_HOLLOW` module into a new campaign when needed, starts or
resumes a session, and sends each player input through the core turn
orchestrator. Type `/quit` or `/exit` to close and recap the session.

Install Dolt into the managed cache when you want local checkpoints and Dolt is
not already on `PATH`:

```bash
loreweaver dolt install
```

Managed Dolt install is consent-based. Non-interactive shells decline
automatically so CI and automation cannot trigger an unattended binary
download.

When working directly from a repository checkout before package publication,
run `npm run build` and invoke the built entrypoint with
`node packages/cli/dist/index.js`.

## Storage Model

Current local CLI storage is explicit and file-based. See
[docs/storage.md](docs/storage.md) for the full user-facing storage boundary.

- **Static bundled content** lives in the package source/build output, including
  `EMBERFALL_HOLLOW` sample module data and SRD catalog data.
- **Live campaign state** lives in the SQLite file named by
  `LOREWEAVER_DB_PATH`. SQLite sidecar files such as `-wal`, `-shm`, or
  `-journal` may appear beside it while the database is open.
- **Dolt checkpoints** live beside that database in `<dbPath>.checkpoints` when
  Dolt is available. Restore/fork commands materialize checkpoints into a new
  SQLite database path chosen by the caller.
- **Beads tracker data** is separate from campaign checkpoints. Checkpoint code
  guards against reusing the beads Dolt ref/remote.
- **Provider secrets** come from the local environment in the CLI MVP. They
  must not be written to campaign SQLite databases, Dolt checkpoints,
  `turn_trace`, exports, or logs. Hosted BYOK secret handling is governed by
  ADR 0002.

Default app-data directories and release-package storage conventions are not
settled yet; they are part of the post-MVP distribution planning work.

## Contributing

- Issue tracking uses **bd (beads)**, not GitHub issues or markdown TODO lists.
  Run `bd ready` to find available work and `bd prime` for the full workflow.
- Operational guidance for both humans and AI agents lives in
  [AGENTS.md](AGENTS.md). `CLAUDE.md` simply imports it.
- Bundled or publicly shared campaign/rules content must be open-licensed,
  public domain, original, or publisher-licensed.

## License

Not yet finalized. Any bundled or publicly shared campaign/rules content must
be open-licensed, public domain, original, or publisher-licensed.
