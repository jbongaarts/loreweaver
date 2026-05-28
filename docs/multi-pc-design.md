# Multiple Player Characters — Design

Tracking epic: `loreweaver-d4d`. This document is the reviewed design the epic's
acceptance criteria require before implementation issues are created.

## Goal

Support campaigns with more than one player character (PC) instead of assuming a
single protagonist. The target near-term shape is **solo multi-PC and
small-group play driven by one local user** (the CLI player), e.g. a party of
two to four PCs plus companions. The object model must not foreclose multiple
distinct human players later, but distinct human identity/seat management is out
of early scope (no auth layer; consistent with ADR 0003 local-CLI-first).

## What the foundation already provides

The party-oriented data refactor (`loreweaver-0jq.8`, schema **v9**) already did
the schema-breaking work, so the **party model itself needs no migration**. The
only schema change this epic adds is one additive, nullable
`turn_trace.acting_character_id` column (**v9→v10**) for per-PC memory
attribution (§4):

- `character` is multi-row: `TEXT` primary key, `role` column (`'pc'` default),
  singleton `CHECK (id = 1)` removed.
- `inventory.character_id` is a nullable FK to `character(id)`.
- The active PC is tracked in `meta.active_character_id`.
- `state/activeCharacter.ts` provides `get/try/set ActiveCharacterId`,
  `resolveCharacterId(db, explicitId?)`, and `ensureCharacterRow`.
- `completeCharacterCreation` accepts an optional `characterId` (defaults
  `pc-1`), inserts the row, and sets it active.
- `domainMutations` (`adjustHp`, `addCondition`, `removeCondition`, `giveItem`,
  `removeItem`) already resolve the target via `ctx.characterId ?? active`.
- The v8→v9 migration copies the legacy `id = 1` row to `pc-1`, links existing
  inventory to it, and sets `active_character_id`. Solo play is a one-member
  party.

So the rest of the epic is a **read / orchestration / UX layer** on top of a
sound model — not a storage change.

## Gaps this epic closes

1. **No party roster read.** `readStateSnapshot` reads only the active PC, and
   `AssembledContext.state.character` is singular. There is no API to list the
   party.
2. **Context assembly is single-PC.** The per-turn prompt renders only the
   active PC; the DM never sees the rest of the party's status. Inventory is read
   with `character_id = ? OR character_id IS NULL`, which leaks legacy
   NULL-owned items into whichever PC is active.
3. **Tools cannot target a non-active PC.** `adjust_hp`, `add_condition`,
   `remove_condition`, `give_item`, `remove_item` expose no `character` argument,
   so the DM can only mutate the active PC even though `domainMutations` already
   accept `ctx.characterId`.
4. **No turn-level attribution.** `RunTurnInput.playerInput` carries no notion of
   which PC is acting, and the turn trace does not record an acting PC.
5. **CLI has no party affordances.** `ensureCharacterReady` checks only the
   single active PC; there is no create-additional-PC, list-party, or
   switch-active-PC flow.
6. **Memory does not preserve per-PC perspective.** Scene/session/arc summaries
   and the campaign bible are party-level prose with no per-PC salience tagging,
   so individual-PC important facts can be lost in roll-up.

## Design decisions

### 1. Control & identity model

One local user controls the whole party. Attribution is **by PC, not by human**:
the unit of "who is acting" is a `character.id` with `role = 'pc'`. A future
multi-human layer can map seats/identities onto PC ids without reworking state.
Companions/familiars/hirelings use the same table with a non-`pc` `role` so they
are party members for state purposes but excluded from "playable PC" listings.

### 2. Input attribution — "acting character"

Introduce an explicit **acting character** for a turn, distinct from the
long-lived **active character**:

- The **active** PC (`meta.active_character_id`) is the default actor and the
  default subject of the rendered character sheet.
- A turn may name an **acting** PC; when omitted it defaults to the active PC.
- `RunTurnInput` gains `actingCharacterId?: string`. The orchestrator threads it
  into `ToolContext` so mutation tools default to the acting PC, and records it
  on the turn trace for replay/audit.
- The CLI changes the active PC between turns (`/switch`) rather than parsing
  per-line actor prefixes, keeping the turn-loop input contract simple.

### 3. State representation & mutations

No schema change. Two read/write refinements:

- Add `listParty(db)` (and a party-aware snapshot) returning every
  `role = 'pc'` character as a compact roster entry (id, name, class, level, HP,
  conditions, active flag). Companions can be included under a separate roster
  section keyed by `role`.
- **Scope inventory to its owner.** Replace the `OR character_id IS NULL` read
  with strict `character_id = ?`. Legacy NULL-owner rows were already assigned to
  `pc-1` by the v9 migration, so the back-compat fallback is now a bleed risk,
  not a safety net. `giveItem` already stamps `character_id`; `removeItem`'s
  NULL-tolerant predicate is narrowed to the owning PC.

### 4. Context assembly & memory

- `AssembledContext` gains a **party roster** (compact one-line-per-PC status:
  name, class/level, HP, active conditions, active marker) alongside the **full
  sheet of the active/acting PC** and that PC's inventory. Non-active PCs'
  detailed sheets/inventory are reachable via `memory_drilldown` so the stable
  prompt head stays compact and cache-friendly.
- `renderContextMessage` renders a `## Party` section (roster) plus the existing
  `## Game State` section scoped to the active/acting PC.
- **Memory:** keep summaries party-level (no per-PC summary tables in v1), but
  tag per-PC important facts through existing `salient_refs` using `character.id`
  so deaths, level-ups, and signature items survive roll-up. A heavier per-PC
  memory projection is deferred unless playtesting shows party-level prose loses
  individual arcs.

### 5. CLI affordances

- Character creation supports adding PCs beyond the first (`pc-2`, …), reusing
  `completeCharacterCreation` with an explicit `characterId`.
- `ensureCharacterReady` requires **at least one** canonical PC (not that every
  row is complete), so a party can be built incrementally.
- New session commands: `/party` (list roster), `/switch <pc>` (set active PC),
  and a create-PC entry point. Switching updates `meta.active_character_id`.

### 6. Migration & backward compatibility

The party model is covered by v9 already: a legacy single-PC DB is a one-member
party (`pc-1`, active). The one migration this epic introduces is **v9→v10**, an
additive nullable `turn_trace.acting_character_id` column used for per-PC memory
attribution (§4). It rewrites no data — pre-v10 traces read back with an
undefined acting PC. The stale singleton framing in `docs/game-state.md` and
`docs/character-creation.md` is updated to the party model as part of the work.

## Out of scope (this epic)

- Multiple distinct human players with identity/auth or networked seats.
- Per-PC private channels / hidden information between players.
- Initiative/turn-order automation for combat (separate concern).
- Per-PC memory projection tables (deferred; revisit after playtesting).

## Proposed implementation breakdown

Created as child issues of `loreweaver-d4d` after this design is reviewed:

1. **Party roster read API** — `listParty` + party-aware state snapshot; unit
   tests for multi-PC and companion roles.
2. **Context assembler party support** — roster section, active-PC sheet,
   inventory scoped to owner (drop NULL fallback), drilldown for non-active PCs;
   render + tests.
3. **Tool character targeting** — optional `character` (id or name) on
   `adjust_hp`, `add/remove_condition`, `give_item`, `remove_item`, resolving to
   acting/active PC by default; tests.
4. **Turn acting-character attribution** — `RunTurnInput.actingCharacterId`
   threaded to `ToolContext` defaults and the turn trace; tests.
5. **CLI party UX** — create additional PCs, `/party`, `/switch`, multi-PC
   `ensureCharacterReady`; tests.
6. **Per-PC memory salience** — tag scene/session salient refs with
   `character.id`; tests.
7. **Docs refresh** — update `docs/game-state.md` and
   `docs/character-creation.md` to the party model.
