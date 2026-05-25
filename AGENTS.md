# Agent & Contributor Guide

Single source of operational guidance for AI agents (Claude Code, Codex) and
humans. `CLAUDE.md` just imports this file — keep shared guidance here only so
the two can't drift. Issue-tracker workflow and the mandatory session-close
protocol are in the **Beads Issue Tracker** / **Session Completion** sections
below.

## Build & Test

Monorepo (npm workspaces): `@loreweaver/core` + `@loreweaver/cli`.

```bash
npm ci             # clean install (CI)
npm install        # local install
npm run build      # tsc --build (incremental)
npm run clean      # tsc --build --clean (removes dist AND .tsbuildinfo)
npm run typecheck  # tsc --build --force (deterministic full build; used by CI)
npm run test       # vitest run
```

Expected: **all non-skipped tests pass.** The suite skips by default the
live-API integration tests (`model.integration.test.ts` and
`campaignBibleFaithfulness.integration.test.ts`, both gated off unless a real
provider key is supplied) and any Dolt-gated checkpoint tests when the `dolt`
binary is absent. Treat exact pass/skip counts as approximate — they grow with
the suite; the gate is that nothing outside those documented skips fails. (As a
rough current baseline the suite is ~239 tests across 37 files.)

**Deterministic builds / core-alone boundary proof:** `tsc --build` is
incremental and keys off `packages/*/tsconfig.tsbuildinfo`. Deleting only
`dist/` leaves a stale `tsbuildinfo`, so `tsc` reports up-to-date, emits
nothing, and exits 0 — a false negative for any proof that builds `@loreweaver/core`
alone and asserts `packages/core/dist/index.js` exists. Always reset with
`npm run clean` (clears `dist` **and** `tsbuildinfo`) before such a proof, or
use `npm run typecheck` (`--force`). CI uses `--force` for this reason.

**Native dep — `better-sqlite3` (the only compiled dependency):** use
**Node 22 LTS**. The pinned `11.x` ships a Node 22 prebuilt but **no Node 24
prebuilt**; on Node 24 the install silently source-compiles and fails without a
C++ toolchain. CI pins Node 22 and sets `npm_config_build_from_source=false` so
a missing prebuilt fails loud instead. Fallback: install a C++ toolchain and
`npm rebuild better-sqlite3`, or upgrade to `better-sqlite3` 12.x (ships the
Node 24 prebuilt). Full rationale: header comment in
`.github/workflows/ci.yml`.

## Architecture

Text-first, persistent AI Dungeon Master for long-running fantasy campaigns;
UI-agnostic TypeScript core with a thin CLI. Full strategy in
`docs/architecture-report.md` and `docs/adr/0001-product-model-deployment-content-strategy.md`.
Load-bearing principles:

- Keep rules/mechanics, campaign/module content, live state, user-private
  content, and generated memory separate.
- Deterministic math/dice/canon writes go in tools; narration and rulings go
  through the DM model under bounded-context orchestration.
- SQLite is the live per-turn store; Dolt is only for checkpoint/history/branch
  work off the per-turn path.
- Model access sits behind provider adapters + capability profiles (Claude
  Agent SDK is one adapter, not a core assumption).
- Primary DM targets premium frontier quality; cheaper models are
  auxiliary/experimental unless validated.

## Conventions

- All task tracking via beads (see below) — never TodoWrite or markdown TODOs.
- Bundled/public content must be open-licensed, public domain, original, or
  publisher-licensed; fair use is not the permission model.
- Native VTT, native mobile, hosted billing, and custom/local primary-DM
  replacement are out of early scope absent a new decision record.
- `@loreweaver/core` has two import paths and they are **not** interchangeable:
  the root export (`packages/core/src/index.ts`) is the stable public surface
  for external consumers; `@loreweaver/core/internal`
  (`packages/core/src/internal.ts`) re-exports movable internals with **no**
  compatibility promise. Production callers (the CLI today, hosted/PWA
  consumers tomorrow) should depend only on the root. The `/internal` subpath
  is for co-developed callers inside this repo (e.g. tests that assert against
  implementation details). New core symbols default to internal — promote to
  the root export only when a real consumer needs the API.

## Non-Interactive Shell

Always pass non-interactive flags so aliased confirmation prompts can't hang
the agent: `cp -f`, `mv -f`, `rm -f` / `rm -rf`, `apt-get -y`, and
`ssh`/`scp -o BatchMode=yes`.

## Git & PR Workflow

Completed work is integrated to `main` by pull request, not by direct pushes to
`main`. Agents should work on a feature branch, run the relevant quality gates,
commit, push the branch, open a PR targeting `main`, and hand off the PR URL for
review.

Routine agent handoff stops at an open PR. Do not merge the PR yourself unless
the user explicitly asks you to merge after review/check requirements are
satisfied. The generated Beads session-completion block below still requires
pushing so work is not stranded locally; in this repository that means pushing
the feature branch and opening the PR for review.

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
