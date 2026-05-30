# ADR 0008: `subclass` and `feature` Record Kinds for Class Ingestion

Status: accepted

Date: 2026-05-29

## Context

The SRD 5.1 class parser (beads `loreweaver-0m9.5.2`) must ingest D&D 5e
classes. A class is not a flat record: each base class (Fighter, Cleric, …)
owns **subclasses** (Champion, Life domain, …) and grants **features** (Action
Surge, Channel Divinity, Rage, …). The class `kindSchema`
(`validateDnd5eClass` in `packages/core/src/rules/kindSchemas.ts`) models only
the base-class scalar fields — `hitDie`, `primaryAbilities`,
`savingThrowProficiencies`, `armorProficiencies`, `weaponProficiencies` — and
the `RulesRecordKind` union (`packages/core/src/rules/types.ts`) has no kind for
subclasses or features. The class parser bead was filed with a HUMAN flag
because it could not proceed until two modeling questions were answered:

1. How are subclasses represented?
2. How are class features represented (no `feature` kind exists)?

### The governing constraint: a name-addressed lookup surface

The only interface the DM model has to rules content is the `lookup_rules` tool
(`packages/core/src/orchestrator/toolLookupRules.ts`). It addresses records by
**`(kind, name)` or `(kind, ref)`**, backed by the `recordsByKind → byKey /
byName` indexes built in `resolveRulesStack`
(`packages/core/src/rules/stack.ts`). There is no "list children of", no nested
traversal, and no relational join. A lookup returns exactly one record and its
full `data` blob.

This yields the load-bearing distinction for this decision:

> Anything embedded inside a parent record's `data` is **retrievable** (it rides
> along when the parent is fetched) but only **addressable** if it is a
> top-level record with its own `kind` and `name`.

Subclasses and features are precisely the elements a DM pulls *by the name a
player says* mid-session ("I'm a Battle Master"; "does Action Surge recharge?").
Making them addressable is therefore high-value, not incidental.

### `overrides` is pack layering, not a subtype link

An earlier framing of the subclass question proposed separate `class` records
carrying `overrides: ['class:<parent>']`. That misreads the `overrides` field.
In `mergeRecord` (`stack.ts`) `overrides` is the **pack-layering replacement**
mechanism: an override record *removes the named record from the resolved stack
and replaces it*, and must preserve the same `kind`, `key`, and `systemId`. A
`Champion` record overriding `fighter` would delete Fighter from the class
index. `overrides` expresses "this homebrew record supersedes that SRD record,"
never "this record is a subtype of that one." Parent/child links between rules
records must live in `data`, not in `overrides`.

### Why not the cheaper alternatives

- **Embed subclasses/features in the class `data` blob.** Cheapest and
  self-contained, but the embedded entries are invisible to `lookup_rules` — the
  DM cannot fetch "Champion" or "Action Surge" by name, and the embedded data is
  unvalidated (extra `data` fields are ignored by the kind validators), inviting
  silent schema drift. Features in particular are not class-only: subclasses,
  ancestries/races, and backgrounds all grant them, so embedding scatters one
  concept across many parent blobs.
- **Model subclasses as `class` records.** Fights the schema:
  `validateDnd5eClass` requires `hitDie` and the four proficiency arrays, none of
  which a subclass has. It would force dummy values or a conditional carve-out,
  and it pollutes the `class` index with non-classes.
- **Reuse the existing `feat` kind for features.** Semantically wrong: feats are
  player-*selected* options gated by prerequisites; features are class-*granted*
  at fixed levels. Collapsing them corrupts both schemas and any future
  character-build logic that distinguishes them.

## Decision

Add two new record kinds to `RulesRecordKind`: **`subclass`** and **`feature`**.
Each is a first-class, name-addressable, schema-validated record that links to
its parent via a field in `data` (not via `overrides`).

### 1. `subclass` kind

- A `subclass` record represents one subclass option (Champion, Life domain,
  School of Evocation, …).
- It links to its parent base class through `data.parentClass` (the parent
  class record's `key`). The link is data; the stack resolver does not interpret
  it.
- Its `kindSchema` validates only fields a subclass actually carries (e.g.
  `parentClass`, a description, and the features it grants by reference) — it
  does **not** require the base-class scalar fields.
- Base classes remain `class` records, unchanged.

### 2. `feature` kind

- A `feature` record represents one class- or subclass-granted feature (Action
  Surge, Channel Divinity, Rage, …), distinct from the player-selected `feat`
  kind.
- It links to its grantor through a `data` field (e.g. `data.source` naming the
  granting `class`/`subclass` record key, and the level at which it is gained).
- Its `kindSchema` validates the feature's own fields (name carried by the
  record, description text, level/source linkage).
- `feat` is left unchanged and continues to mean player-selected options.

### 3. Linkage convention

Parent → child relationships between rules records are expressed by a child-side
`data` reference to the parent record's `key` (`data.parentClass`,
`data.source`). `overrides` is reserved for its existing pack-layering meaning
and must not be used to express subtype or grant relationships.

### 4. Scope split

This ADR authorizes the kinds; the implementation is split across beads so the
base-class parser is not blocked on the relational work:

- `loreweaver-0m9.5.2` is narrowed to **base-class parsing** (the `class`
  records only) and unblocked.
- New beads cover the `feature` kind + schema, the `subclass` kind + schema, and
  the subclass/feature parsers, with dependencies recorded in beads.

## Consequences

- Subclasses and features become addressable via `lookup_rules({ kind:
  'subclass' | 'feature', name })` and validated by their own kind schemas,
  matching how every other distinct game concept in this engine is modeled.
- `RulesRecordKind` is part of the stable root export
  (`packages/core/src/index.ts`); adding union members is additive and
  backward-compatible for external consumers, but each new kind is a permanent
  public API commitment.
- Adding a kind is bounded and compiler-enforced: `BASE_KIND_VALIDATORS` in
  `kindSchemas.ts` is an exhaustive `Record<RulesRecordKind, Validator>`, so the
  compiler forces a validator entry for each new kind. The `lookup_rules` tool
  `enum` (in `toolLookupRules.ts`, two places) must be extended in lockstep.
  These packs are bundled TypeScript constants, so there is no per-turn SQLite
  schema or migration impact.
- Per ADR 0007, the new records remain importer-produced from the vendored SRD
  artifact; the kinds add structure, not a new authoring path. Subclass and
  feature field values must still be extracted deterministically from the
  source, never authored from model knowledge.

## Rejected Alternatives

- **Embed subclasses and features in the class `data` blob.** Rejected: not
  addressable by the name-keyed `lookup_rules` surface and not schema-validated,
  causing silent drift and scattering features across every grantor's blob.
- **Subclasses as `class` records.** Rejected: violates the `class` kindSchema's
  required base-class fields and pollutes the `class` index with non-classes.
- **Subclasses/features linked via `overrides`.** Rejected: `overrides` is the
  pack-layering replacement mechanism in `stack.ts`; using it as a subtype link
  would delete the parent from the resolved stack.
- **Reuse `feat` for class features.** Rejected: conflates player-selected feats
  with class-granted features, corrupting both schemas.
- **Defer subclasses and features entirely (base classes only, no new kinds).**
  Rejected for the long term: subclasses and features are core to play and are
  the highest-value records to make addressable. Base-class-only shipping is
  retained only as the *interim* state of `loreweaver-0m9.5.2` while the new-kind
  beads land.
