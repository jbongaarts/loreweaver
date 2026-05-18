# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:7510c1e2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->


## Build & Test

Monorepo (npm workspaces): `@loreweaver/core` + `@loreweaver/cli`.

```bash
npm ci             # clean install (CI)
npm install        # local install
npm run build      # tsc --build (incremental)
npm run typecheck  # tsc --build --force (deterministic full build; used by CI)
npm run test       # vitest run
```

Expected test result: **20 passed / 1 skipped** (the skipped one is
`model.integration.test.ts`, a live-API integration test gated off by default).

### better-sqlite3 native binary / CI

`better-sqlite3` is the **only** native/compiled dependency. Its npm install
script is `prebuild-install || node-gyp rebuild`: it first tries to download a
precompiled `.node` binary matching the running Node ABI
(`NODE_MODULE_VERSION`); if no matching prebuilt exists it falls back to
**compiling from source** with node-gyp + a C++ toolchain (MSVC on Windows,
build-essential on Linux).

**Failure mode:** The pinned `better-sqlite3@^11.3.0` (resolved `11.10.0`)
ships prebuilt binaries for Node ABIs `v108/v115/v127/v131`
(Node 18/20/22/23) but **NOT `v137` (Node 24)**. On Node 24, `prebuild-install`
gets an HTTP 404 and the install silently falls back to a source compile —
which **fails on any clean/CI environment without a C++ toolchain**. (This is
why the dev machine compiled better-sqlite3 from source under Node 24 during
cck.3.)

**CI strategy (primary path — no compiler required):**

- CI runs on **Node 22 LTS** (ABI `v127`), which has a confirmed `11.10.0`
  prebuilt (`better-sqlite3-v11.10.0-node-v127-linux-x64.tar.gz`).
- CI sets `npm_config_build_from_source=false` so a missing prebuilt **fails
  the job loudly** instead of silently attempting a source compile.
- Verified locally: `prebuild-install` for the Node 22 ABI downloads the
  prebuilt binary over HTTP 200 with **no node-gyp / no MSVC invocation**.

**Node version divergence from the E0 epic (intentional):** the epic targets
Node 24, but CI runs Node 22 LTS because the pinned better-sqlite3 11.x has no
Node 24 prebuilt. Moving CI to Node 24 requires upgrading better-sqlite3 to the
**12.x line** (12.x ships the `v137`/Node-24 prebuilt) — a separate
major-version-upgrade decision, not part of CI setup. Dev machines on Node 24
still work because they compiled better-sqlite3 from source locally.

**Documented fallback** (if a prebuilt is ever unavailable for the chosen
Node/OS):

1. Provision a C++ build toolchain on the runner and run
   `npm rebuild better-sqlite3` (Linux: `build-essential python3`;
   Windows: `windows-build-tools` / Visual Studio Build Tools), **or**
2. Upgrade `better-sqlite3` to a version whose prebuilds cover the target
   Node ABI (e.g. 12.x for Node 24 / ABI `v137`).

The CI strategy and rationale are also summarized at the top of
`.github/workflows/ci.yml`.

## Architecture Overview

Loreweaver is a text-first, persistent AI Dungeon Master for long-running
fantasy campaigns. The core is a UI-agnostic TypeScript library with a thin CLI
front end for MVP development and power-user testing. Future public UX is
expected to be a mobile-friendly web app/PWA, not native mobile first.

Core architecture principles:

- Keep rules/mechanics, campaign/module content, live campaign state,
  user-private content, and generated campaign memory separate.
- Keep deterministic math, dice, and canon writes in tools; narration and
  rulings go through the DM model under a bounded-context orchestration layer.
- Use SQLite as the live per-turn store and Dolt only for checkpoint/history/
  branch operations outside the per-turn path.
- Isolate model access behind provider adapters and model profiles. Claude Agent
  SDK is an initial adapter, not a core assumption.
- Target premium frontier-model quality for the primary DM profile; cheaper
  models are experimental or auxiliary unless validated.

See `docs/architecture-report.md` and
`docs/adr/0001-product-model-deployment-content-strategy.md`.

## Conventions & Patterns

- Use beads for all task tracking.
- Public or bundled content packs must be open-licensed, public domain,
  original, or publisher-licensed. Do not rely on fair use as the load-bearing
  permission model.
- Do not make native VTT, native mobile, hosted billing, or custom/local primary
  DM replacement work part of early scope unless a new decision record changes
  that strategy.
