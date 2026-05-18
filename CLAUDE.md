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

_Add your build and test commands here_

```bash
# Example:
# npm install
# npm test
```

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
