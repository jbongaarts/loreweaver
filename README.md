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

The promise: open-ended text adventure **plus** tabletop rules and
consequences **plus** persistent campaign memory. It should feel like a real
DM inhabiting a living world, not a video game missing its graphics.

> **Project status:** early scaffolding / pre-MVP. The repository currently
> contains the provider-neutral core seam, model-profile configuration, a
> SQLite persistence layer, and a thin CLI that loads config and prints a
> banner. The campaign game loop is not yet implemented. Expect rapid change.

## Why it's built this way

- **Text-first.** The MVP is pure text: narration, player input, dice/results,
  state tracking, campaign memory, summaries, checkpoints, and
  theater-of-the-mind combat. Structured UI panels, tactical abstractions, and
  any VTT export come later — native VTT and native mobile are explicit
  non-goals for early scope.
- **CLI now, web later.** Near-term development is CLI/local-friendly (fastest
  route to the core game loop, local campaign state, bring-your-own-key use).
  The likely public product is a hosted, mobile-friendly web app / PWA.
- **Provider-neutral core.** Model access is isolated behind provider adapters
  and capability-based **model profiles** (e.g. `premium_dm`,
  `state_extractor`, `summarizer`). The Claude Agent SDK is the initial
  adapter, not a hardcoded assumption.
- **Premium quality floor.** The primary DM targets frontier-model quality
  (Opus 4.6+ / GPT-5.5-class or a future equivalent). Cheaper models are only
  for bounded auxiliary tasks that cannot corrupt canon. Loreweaver targets a
  *capability* floor, not a *price* floor.
- **Separated knowledge.** Rules/mechanics, campaign/module content, live
  campaign state, user-private content, and generated memory are kept
  separate. Bundled/public content must be open-licensed, public domain,
  original, or publisher-licensed — fair use is not the permission model.

See [`docs/architecture-report.md`](docs/architecture-report.md) for the full
strategy and [`docs/adr/0001-product-model-deployment-content-strategy.md`](docs/adr/0001-product-model-deployment-content-strategy.md)
for the governing decision record.

## Repository layout

Monorepo using npm workspaces:

| Package            | Path             | Role                                                    |
| ------------------ | ---------------- | ------------------------------------------------------- |
| `@loreweaver/core` | `packages/core`  | UI-agnostic engine: config, model adapters, persistence |
| `@loreweaver/cli`  | `packages/cli`   | Thin CLI front end for development and power-user use    |

## Getting started

### Prerequisites

- **Node.js 22 LTS recommended.** The one native dependency
  (`better-sqlite3`) ships a prebuilt binary for Node 22 but **not** Node 24;
  on Node 24 the install falls back to compiling from source and needs a C++
  toolchain. See the *Build & Test* section of
  [AGENTS.md](AGENTS.md#better-sqlite3-native-binary--ci) for details.

### Install, build, test

```bash
npm install        # local install (use `npm ci` for a clean/CI install)
npm run build      # tsc --build (incremental)
npm run typecheck  # tsc --build --force (full deterministic build)
npm run test       # vitest run
```

Expected test result: **20 passed / 1 skipped** (the skipped test is a
live-API integration test, gated off by default).

### Configuration

Copy `.env.example` to `.env` and fill in values:

```bash
cp .env.example .env
```

Key settings:

- `LOREWEAVER_DB_PATH` — SQLite database file for the active campaign.
- `LOREWEAVER_MODEL` / `ANTHROPIC_API_KEY` — model and credentials for the
  Claude Agent SDK adapter (bring your own key).
- `LOREWEAVER_PROFILE_*` — optional per-profile provider/model overrides.
  Loreweaver routes tasks to capability-based profiles rather than hardcoded
  provider names.

### Run the CLI

```bash
node packages/cli/src/index.ts
```

Currently this prints the core version and resolved config (database path and
model) — the campaign loop is not wired up yet.

## Contributing

- Issue tracking uses **bd (beads)**, not GitHub issues or markdown TODO
  lists. Run `bd ready` to find available work and `bd prime` for the full
  workflow.
- Operational guidance for both humans and AI agents lives in **[AGENTS.md](AGENTS.md)**
  (build, test, conventions, and the session-completion / push protocol).
  `CLAUDE.md` simply imports it.

## License

Not yet finalized. Note that any bundled or publicly shared campaign/rules
content must be open-licensed, public domain, original, or publisher-licensed.
