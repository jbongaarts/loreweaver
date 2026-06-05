# D&D 5e SRD 5.1 Importer

Deterministic extractor for the D&D 5th Edition System Reference Document 5.1
(CC-BY-4.0). Reads a vendored PDF, extracts canonical `RulesRecord`s, and
writes a `manifest.json` + `records.json` pair compatible with
`loadRulesPackFromDirectory`.

Tracked work: beads `loreweaver-0m9.5` (remaining unimplemented kinds are
tracked as child issues).

## Scope today

| Record kind | Status |
|-------------|--------|
| `spell`     | Implemented. Stat-block parser extracts name, level, school, ritual flag, casting time, range, components (incl. material text), duration, description, and "At Higher Levels" upcast text. Class lists are cross-referenced from the class-spell-list section. |
| `action`    | Implemented. Parser extracts the 10 standard SRD combat actions (Attack, Cast a Spell, Dash, Disengage, Dodge, Help, Hide, Ready, Search, Use an Object) from the combat-actions section into `kind=action` records with `data.description`. |
| `creature`  | Implemented (317 records: 296 monsters + 21 NPCs). Stat-block parser extracts every creature from the Monsters section AND Appendix MM-A into `kind=creature` records satisfying the `dnd5e-srd` creature kindSchema: `size`, `type` (subtype parenthetical preserved; validation applied to the bare type word), `alignment`, `armorClass`, `hitPoints`, `speed` (mode→feet map; the unlabeled base speed keyed as `walk`), `challengeRating` (bare fraction/integer), and `abilityScores`. A stat block is confirmed by its size/type/alignment meta line plus the AC/HP/ability-table signature. **Appendix MM-B: Nonplayer Characters** (the 21 generic NPC stat blocks — Acolyte, Bandit Captain, Berserker, …) is imported too (loreweaver-bn0): an NPC stat block has the identical shape and is equally encounter-usable, so it emits under the same `creature` kind via the same parser, distinguished by a `data.category: 'npc'` discriminator. Monster records carry no `category` field — its absence means "monster" — so the 296 monster records stay byte-identical and the two coverage baselines never mix. Section anchors: `monsters` (`startHeading: /^Monsters$/`, `requireEndHeading: true`), `miscellaneousCreatures` (Appendix MM-A, best-effort), and `nonplayerCharacters` (Appendix MM-B, best-effort start, runs to EOF). `runImporter` fails closed via two independent coverage guards: an empty Monsters parse always throws, the real import (CLI + `verify:dnd5e-srd-pack`) validates monster names against the exact `EXPECTED_SRD_5_1_CREATURE_NAMES` set (296) and NPC names against `EXPECTED_SRD_5_1_NPC_NAMES` (21) — any missing, renamed, or spuriously-extracted entry throws by name (`CreatureCoverageError` / `NpcCoverageError`) and writes nothing (loreweaver-0m9.5.14, loreweaver-bn0). Both sets are reviewed, checked-in regression baselines (the monster candidate is generated via `npm run generate:dnd5e-srd-creature-names`, reviewed against the SRD source, then committed), not runtime-derived expected data. Fixture pipelines that exercise a reduced Monsters section omit the exact sets and rely on the empty-result guard or the coarse `minCreatureCount` floor; a fixture without an MM-B appendix degrades to zero NPCs. |
| `class`     | Implemented (base classes only). Parser keys off each base class's "Hit Dice: 1dN per <class> level" signature line and reads the labeled proficiency / saving-throw lines from its Class Features block into `kind=class` records satisfying the `dnd5e-srd` class kindSchema (`hitDie`, `armorProficiencies`, `weaponProficiencies`, `savingThrowProficiencies`, best-effort `primaryAbilities`). Section anchor: `classes` (`startHeading: /^Classes$/`, `endHeading: /^Using Ability Scores$/`, `requireEndHeading: true`). `runImporter` fails closed via a class-coverage guard (`MIN_EXPECTED_SRD_5_1_CLASSES`). `primaryAbilities` is filled from the Multiclassing "Prerequisites" listing (see `parseMulticlassing.ts`) because the Class Features block prints no key-ability line (ADR 0007); this enrichment is best-effort, so a class absent from that listing keeps an empty array and a PDF without a locatable Multiclassing section is not a failure. Subclasses and class features are separate kinds (ADR 0009). |
| `subclass`  | Implemented. Parser extracts the 12 SRD 5.1 subclasses (one per base class: Champion, Life Domain, School of Evocation, …) from the same Classes-chapter slice by exact heading-name match (after whitespace normalization, so column-spaced multi-word headings like `School   of   Evocation` still match) into `kind=subclass` records. Each links to its parent base class via `data.parentClass` (the `class:<slug>` key — data-side linkage per ADR 0009, never `overrides`) and carries the subclass body prose in `data.description`. Base-class names bound a subclass's description so the next class's intro prose cannot bleed in. `runImporter` fails closed via a subclass-coverage guard: an empty subclass parse (or a count below `minSubclassCount`, which the CLI sets to `MIN_EXPECTED_SRD_5_1_SUBCLASSES`) throws `SubclassCoverageError` and writes nothing. Granted features are separate `feature` records. |
| `feature`   | Implemented. Parser extracts class- and subclass-granted features from the Classes-chapter slice into `kind=feature` records satisfying the `dnd5e-srd` feature kindSchema (`data.source` keyed to the grantor `class:<slug>` / `subclass:<slug>`, integer `data.level`, `data.description`). Grantor context is tracked by known base-class and subclass names (the same anchors `parseSubclasses` uses). Feature identity and grant level come primarily from class/subclass progression-table rows; leading prose clauses like "At 3rd level" are used only as a fallback when no table anchor exists. Unanchored title-case option subheadings inside feature bodies remain in the parent feature description. `runImporter` fails closed via a feature-coverage guard: an empty feature parse (or a count below `minFeatureCount`, which the CLI sets to `MIN_EXPECTED_SRD_5_1_FEATURES`) throws `FeatureCoverageError` and writes nothing. Shares the `classes` slice (ADR 0009 / loreweaver-0m9.5.18). |
| `background`| SRD 5.1 does not publish backgrounds; see ADR 0005. |
| `ancestry`  | Implemented. Parser extracts the SRD 5.1 races and subraces by known-name match into `kind=ancestry` records (`data.source = 'race'` per ADR 0005). Parents and subraces are **separate records**; each subrace record is **flattened/self-contained** — its `data.traits` merge the parent's shared traits with the subrace's own additions, with `data.subraceOf` back-referencing the parent and the parent's `data.subraces` listing its children (no `overrides`). Section anchor: `races` (`startHeading: /^Races$/`, `endHeading: /^Classes$/`, `requireEndHeading: true`). |
| `equipment` | Implemented (218 records). Parser projects the Equipment chapter and the Mounts and Vehicles section into per-item `kind=equipment` records, all carrying `category` plus verbatim `cost`/`weight` where the source lists them: armor (13: `ac`, `armorType` from the AC cell, `stealthDisadvantage`, optional `strengthRequirement`), weapons (37: `damageDie`, `damageType`, `properties[]`), tools (35), Adventuring Gear (99) + Tack/Harness/Drawn Vehicles (13) as `category='gear'`, Equipment Packs (7: `category='pack'`, verbatim contents `description`), mounts (8: `category='mount'`, `speed`, `carryingCapacity`), and waterborne vehicles (6: `category='vehicle'`, `speed`). The real SRD 5.1 PDF extracts Armor and Weapons as two physical columns (left/right blocks zipped positionally) while Tools extracts row-major. **Adventuring Gear (loreweaver-4zu)** is the hard case: its left column's item names arrive as one bare run, then the left cost/weight values interleave line-by-line with the right column's complete rows, and four category-header rows (Ammunition, Arcane focus, Druidic focus, Holy symbol) carry no value. Reconstruction removes those four reviewed headers from the name run, then length-checks and zips the de-headered names against the left values (a mismatch throws `EquipmentColumnMismatchError('Gear', …)`); the right column's rows are self-contained. The **Container Capacity** table is attached as a verbatim `capacity` field to the matching gear record via a reviewed name-alias map (an unmatched row throws `ContainerCapacityError`). The Tack table's "Saddle" sub-header variants are qualified to "Saddle, <variant>"; its non-priced "Barding ×4 ×2" multiplier row is skipped. Section anchors: `equipment` (`startHeading: /^Equipment$/`, `requireEndHeading: true`) and `mountsAndVehicles` (`startHeading: /^Mounts and Vehicles$/`; end-bounded by "Trade Goods" but `requireEndHeading` is off because `parseMountsAndVehicles` is internally header-bounded). |
| `magic-item` | Implemented (237 records). Parser extracts the full Magic Items A-Z section into `kind=magic-item` records with `data.itemType`, `data.rarity`, `data.requiresAttunement`, optional `data.attunementRequirement`, and `data.description`. The section is two-column and includes item-specific tables and bullets; `parseMagicItems` keeps those embedded tables in the parent item description instead of emitting standalone `table` records, skips interleaved body/stat/bullet/table lines when locating headings, recognizes category lines that begin after a prose prefix on the same extracted line, and handles category headers whose rarity wraps to a continuation line. The real import fails closed against the exact `EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES` set (237), so missing items or promoted prose/table artifacts throw `MagicItemCoverageError` before writing output. Section anchor: `magicItems` (`startHeading: /^Magic Items A-Z$/`, `endHeading: /^(Sentient Magic Items\|Artifacts\|Monsters\|Appendix)\b/i`, `requireEndHeading: true`). |
| `feat`      | Implemented. Parser extracts feat entries (SRD 5.1: Grappler) with optional prerequisites and description text in `data.description`. Section anchor: `feats` (`startHeading: /^Feats?$\|^Feat Descriptions?$/`, `requireEndHeading: true`). |
| `condition` | Implemented. Parser extracts all 15 SRD conditions (blinded, charmed, deafened, exhaustion, frightened, grappled, incapacitated, invisible, paralyzed, petrified, poisoned, prone, restrained, stunned, unconscious). Exhaustion carries a structured `levels` array (6 entries). Section anchor: `conditions` (`startHeading: /^Appendix A: Conditions$\|^Conditions$/`). |
| `hazard`    | Implemented. The canonical SRD 5.1 pack carries **8** `hazard` records, all from the gamemastering "Traps" section (loreweaver-hvp): the eight alphabetic sample traps (Collapsing Roof, Falling Net, Fire-Breathing Statue, Pits, Poison Darts, Poison Needle, Rolling Sphere, Sphere of Annihilation). Traps emit under the `hazard` kind (decision below) with a `data.trapType` discriminator (`"mechanical"` \| `"magic"`, the SRD subtitle) plus a re-flowed `data.description`; "Pits" is one record describing its four inlined variants. `parseTraps` keys each entry off its name line + standalone `Mechanical trap` / `Magic trap` subtitle, so the leading trap-running guidance prose is not promoted. Section anchor: `traps` (`startHeading: /^Traps$/`, `endHeading` at `Diseases`, `requireEndHeading: true`). The real import fails closed against `EXPECTED_SRD_5_1_TRAP_NAMES` (a missing/renamed/spurious trap throws `TrapCoverageError`). The two trap reference tables emit as `table` records (see Reference-table coverage). **No `trap` record kind:** traps fit the `hazard` kindSchema exactly (a description-only environmental danger; the SRD groups Traps with Diseases/Madness/Poisons), and a new kind would force changes across the exhaustive `Record<RulesRecordKind, …>` validators/indexes for no schema benefit. SRD 5.1 has no environmental-hazard chapter (Brown Mold / Green Slime / Webs / Yellow Mold are absent), but the environmental-hazard parser (`parseHazards`, exact-name match, best-effort `hazards` anchor `/^Dungeon Hazards$\|^Hazards$/`) is retained for fixtures and future editions; it emits zero records here. The general trap-running guidance prose (Traps in Play, Triggering/Detecting/Disabling a Trap, Trap Effects, Complex Traps) is intentionally **not** emitted — DM-facing procedure, not a lookupable game entity. |
| `table`     | Implemented. The vendored SRD 5.1 source contains exactly three reconstructable reference tables — Difficulty Classes (`table:difficulty-classes`, p77) and the two trap tables Trap Save DCs and Attack Bonuses (`table:trap-save-dcs-and-attack-bonuses`, p196) and Damage Severity by Level (`table:damage-severity-by-level`, p196, both from the gamemastering Traps slice; loreweaver-hvp) — the three `table` records in the canonical pack. The parser also retains reviewed reconstruction rules for XP Thresholds by Character Level and SRD-style treasure challenge tables (`loreweaver-0m9.5.13` wired the latter through `runImporter`), but those families are absent from the SRD 5.1 PDF and emit nothing for this source; they exist for fixtures and future editions. See "Reference-table coverage" below (loreweaver-46m, loreweaver-hvp). Broader table completeness remains the responsibility of the full-PDF coverage audit. |
| `rule`      | Implemented. The canonical SRD 5.1 pack carries **127** `rule` records. `parseRules` is heading-hierarchy-aware (loreweaver-yli): the SRD core-rules chapters nest five font tiers — chapter (h≈25.9), subsection (h≈18, e.g. "Making an Attack"), sub-subsection (h≈13.9, e.g. "Attack Rolls"), leaf (h≈12, e.g. "Death Saving Throws"), and gray callout-box (h≈10.8, e.g. "Hiding", "Combat Step by Step"). It emits one rule per heading across the Using Ability Scores, Adventuring, and Combat chapters, bounding each body at the next heading of ANY tier so a parent keeps only its intro prose and every leaf is its own record (the prior parser dropped any heading whose next line was also a heading — the "wrapper drop" — leaving only 10 arbitrary leaves). Capturing the h≈10.8 box tier is load-bearing: a box heading below the leaf threshold would otherwise be read as body and swallow its whole rule into the preceding record (the corruption that buried the Hiding rule, with its inline Passive Perception / What Can You See? lead-ins, under the Dexterity "Initiative" sidebar). Font tiers come from the new per-line `PageText.lineHeights` the extractor exposes (parallel to `lines`; `headingLineIndexes` only flags h≥14 and so misses the h≈10.8/12/13.9 rule leaves). Cross-chapter title collisions ("Hit Points" under both Constitution and Damage and Healing; "Initiative" under Dexterity and The Order of Combat; "Difficult Terrain" under Adventuring and Combat movement) and the three per-ability "Spellcasting Ability" cross-reference sidebars get **parent-qualified record keys** (`rule:constitution-hit-points` vs `rule:damage-and-healing-hit-points`) while `name` stays the bare SRD title. Intentionally excluded: `Variant:` optional rules, the per-ability skill-list captions under Ability Checks (bodies that lead with a bullet), and the leaf table captions the `table` kind owns (Ability Scores and Modifiers score table, Typical Difficulty Classes, Travel Pace, Size Categories). The real import fails closed against `EXPECTED_SRD_5_1_RULE_KEYS` (a dropped leaf, renamed heading, or promoted caption/sidebar throws `RuleCoverageError`). Uniform-font fixture PDFs (no distinct tiers) fall back to the legacy text-heuristic, flat extraction. Section anchor: `coreRules` (`startHeading: /^Using Ability Scores$/`, `endHeading: /^Spellcasting$\|^Spell Lists$/`, `requireEndHeading: true`). Full body text stored in `data.text`. The general Spellcasting-rules chapter (`loreweaver-3hp`) and the gamemastering Diseases/Madness/Objects/Poisons sections (`loreweaver-6ra`/`loreweaver-uuk`) remain separate follow-ups. |

The importer does **not** emit empty stubs for unimplemented kinds. Per the
ADR 0007 ingestion policy and the `loreweaver-0m9.5` scope rule, a generated
pack that omits a kind reflects "the parser doesn't cover that yet" -- not "the
SRD doesn't contain those records". The generated manifest's `description`
field lists the included kinds explicitly so downstream callers can tell.

## How to regenerate

1. The SRD 5.1 PDF is vendored in-repo at
   `packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf` (CC-BY-4.0; pinned by
   SHA-256 in `packages/core/sources/dnd5e-srd-5.1/manifest.json`). No download
   step is required for a fresh clone.
2. From the repo root:

   ```bash
   npm run import:dnd5e-srd
   ```

   This runs against the default vendored PDF path and writes to a scratch
   directory at `packages/core/scripts/importers/dnd5e-srd-5.1/.generated/`.
   It does NOT overwrite the canonical pack location.

3. Inspect the output. When a parser/source/schema change is intended to alter
   pack content, overwrite the committed canonical pack:

   ```bash
   npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
   ```

   Then review the diff (`npm run audit:rules-pack` / `npm run diff:rules-pack`),
   update the `srdGeneratedPack` baselines, and commit the regenerated pack so
   `npm run verify:dnd5e-srd-pack` returns to exit 0 (see the regeneration
   procedure below).

The CLI prints the source PDF's SHA-256 on each run. The pinned value lives in
`packages/core/sources/dnd5e-srd-5.1/manifest.json` (`artifact.sha256`); a
mismatch means the PDF in `sources/` was swapped without updating the manifest
-- treat that as a vendoring change, not a routine importer run.

## Regenerating the committed pack

Per the 0m9.6 design, the SRD importer is a one-shot construction tool, not a
per-PR generator. The committed pack at
`packages/core/data/rules-packs/rules__dnd5e-srd-5.1/` is the canonical
importer output from the vendored SRD 5.1 PDF (regenerated under
`loreweaver-1pw`). The default vitest suite asserts that committed pack is
well-formed and matches its reviewed baselines
(`packages/core/test/srdGeneratedPack.test.ts`); the importer is **not** re-run
on every PR. Reproducibility against the vendored PDF is a separate, path-gated
CI job (`.github/workflows/srd-importer-reproducibility.yml`) that runs
`npm run verify:dnd5e-srd-pack` and **fails the PR check on any nonzero exit**.

`npm run verify:dnd5e-srd-pack` is the local-and-CI verification command. Its
exit codes are strict:

- `0` — importer output matches the committed pack byte-for-byte (steady state).
- `1` — importer succeeded but its output differs from the committed pack.
- `2` — verification could not produce a meaningful diff (importer/runtime
  failure, pack-loading failure).

When a change to a gated path (importer/parser code, the vendored PDF + its
manifest, the rules schemas/audit/loader, the verify script, or the lockfile)
is intended to alter pack content, regenerate the committed pack in the same
PR:

1. Regenerate over the committed pack location:

   ```bash
   npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
   ```

2. Review the result with the audit/diff tooling:

   ```bash
   npm run audit:rules-pack -- packages/core/data/rules-packs/rules__dnd5e-srd-5.1
   ```

   `auditPack` must report zero suspicious records. Any partially-populated
   optional field must be a genuinely-optional SRD field — fix the parser, or
   add it to `EXPECTED_PARTIAL_FIELDS` in `srdGeneratedPack.test.ts` with a
   one-line justification, before merging.

3. Update `EXPECTED_COUNTS_BY_KIND`, `EXPECTED_STABLE_KEYS`,
   `EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES`, and `EXPECTED_PARTIAL_FIELDS` in
   `packages/core/test/srdGeneratedPack.test.ts` / `index.ts` to match the
   regenerated pack.

4. Run `npm run verify:dnd5e-srd-pack` and confirm it exits 0. Paste into the
   PR description: the reported source PDF SHA-256 (must match
   `packages/core/sources/dnd5e-srd-5.1/manifest.json` `artifact.sha256`), the
   importer's per-kind counts line, and confirmation that the command exited 0.

## Architecture

```
sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf
        |
        v  extract.ts (pdfjs-dist)
   PageText[]
        |
        v  sections.ts (sliceSection)
   PageText[] narrowed per kind (e.g. spell-descriptions, spell-lists)
        |
        v  parseSpells.ts
   SpellExtraction[]  +  SpellClassIndex
        |
        v  emit.ts
   RulesPack  (validated by validateRulesPack)
        |
        v
   manifest.json + records.json
```

- `extract.ts` -- PDF -> per-page text via `pdfjs-dist`. Groups text items by
  y-coordinate (with rounding) and sorts each line left-to-right. Pure
  function over the PDF buffer.
- `sections.ts` -- `PageText[]` -> per-kind `PageText[]` slice via deterministic
  chapter-heading anchors. Fails closed: an unmatched anchor throws
  `SectionNotFoundError` rather than silently feeding the whole PDF to a kind
  parser. See "Section-anchor table" below.
- `parseSpells.ts` -- narrowed text -> `SpellExtraction[]` by scanning for
  level-school marker lines, then walking backward for the name and forward
  for keyed metadata + description. Class lists are a second pass over the
  spell-lists slice.
- `parseActions.ts` -- narrowed text -> `ActionExtraction[]` by exact heading
  match over the 10 standard SRD combat-action names. Body text is re-flowed
  into `description`.
- `parseCreatures.ts` -- narrowed stat-block text -> `CreatureExtraction[]`
  by scanning for each stat block's size/type/alignment meta line, validating
  the type against the 14 SRD creature types, then reading the keyed stat lines
  (Armor Class, Hit Points, Speed, the STR/DEX/… ability table, Challenge). A
  meta-like sentence without the AC/HP/ability signature is skipped; a
  confirmed block missing Speed or Challenge throws. The same parser drives both
  the Monsters chapter / Appendix MM-A (default `category: 'monster'`) and
  Appendix MM-B: Nonplayer Characters (`category: 'npc'`, passed by the
  orchestrator for the MM-B slice — loreweaver-bn0); the `category` argument is
  stamped onto every extraction and surfaces as `data.category` on NPC records
  only.
- `parseConditions.ts` -- narrowed text -> `ConditionExtraction[]` by exact
  match against the 15 known condition names. Bullet-point lines become
  `effects[]`; exhaustion's level table becomes a structured `levels[]` array.
- `parseHazards.ts` -- narrowed text -> `HazardExtraction[]` by exact match
  against the 4 known SRD 5.1 environmental-hazard names (Brown Mold, Green
  Slime, Webs, Yellow Mold). Body is re-flowed prose paragraphs. Emits nothing
  for SRD 5.1 (those hazards are absent from the source).
- `parseTraps.ts` -- narrowed "Traps"-section text -> `TrapExtraction[]` by each
  sample trap's name line + standalone `Mechanical trap` / `Magic trap`
  subtitle. Skips the leading trap-running guidance prose and the two trap
  tables. Body is re-flowed prose; `trapType` records the subtitle. Emitted
  under the `hazard` kind (loreweaver-hvp).
- `parseRules.ts` -- narrowed core-rules text -> `RuleExtraction[]`, one per
  heading across the subsection/sub-subsection/leaf font tiers
  (`PageText.lineHeights`), bounding each body at the next heading and
  parent-qualifying colliding keys (loreweaver-yli). Body is re-flowed prose in
  `text`; the disambiguated record-key slug is in `keySlug`. Falls back to a
  flat text-heuristic for uniform-font fixtures.
- `parseAncestries.ts` -- narrowed races text -> `AncestryExtraction[]` by
  known-name race/subrace heading match plus "Label. body" trait detection.
  Emits one entry per race and per subrace; subrace entries carry flattened
  (parent + own) traits and a `subraceOf` back-reference.
- `parseSubclasses.ts` -- narrowed Classes-chapter text (the same slice
  `parseClasses` consumes) -> `SubclassExtraction[]` by known-name subclass
  heading match. Each subclass's body re-flows into `description`, bounded by
  the next subclass heading or base-class name so the next class's prose does
  not bleed in; `parentClass` carries the parent base-class name, which `emit.ts`
  keys to the `class:<slug>` record (ADR 0009).
- `parseFeatures.ts` -- narrowed Classes-chapter text -> `FeatureExtraction[]`
  by class/subclass progression-table anchors plus leading-level prose fallback.
  Progression rows supply the canonical grant level and prevent option
  subheadings inside feature bodies from being promoted to feature records.
- `parseMulticlassing.ts` -- narrowed Multiclassing-section text -> a
  class-name → primary-ability map from the "Prerequisites" listing
  ("Fighter Strength 13 or Dexterity 13", ...). `emit.ts` merges it into each
  class record's `primaryAbilities` when the Class Features block carried none
  (loreweaver-0m9.5.19). Best-effort: a missing section yields an empty map and
  empty `primaryAbilities` rather than a failure (ADR 0007).
- `parseTables.ts` -- narrowed core-rules and treasure-table text ->
  `TableExtraction[]` by per-table anchors plus conservative row
  reconstruction for simple reference tables and column-block reconstruction
  for SRD treasure tables. Rows are emitted as structured arrays in
  `data.rows`.
- `parseEquipment.ts` -- narrowed Equipment-chapter text ->
  `EquipmentExtraction[]` for armor, weapons, tools, Adventuring Gear (+
  Container Capacity), and Equipment Packs; `parseMountsAndVehicles` handles the
  separate Mounts and Vehicles slice (mounts, tack/harness/drawn vehicles,
  waterborne vehicles). The real SRD 5.1 PDF lays out the Armor and Weapons
  tables as two physical columns, so each table arrives split into a left
  column-block (Name/Cost/AC or Name/Cost/Damage) and a right column-block
  (Strength/Stealth/Weight or Weight/Properties); the parser collects both and
  zips them positionally. Tools extract row-major. Adventuring Gear interleaves
  its left cost/weight values with the right column's complete rows and carries
  four valueless category headers, so the de-headered left names are
  length-checked and zipped against the left values, the right rows are
  self-contained, and Container Capacity is attached as a verbatim `capacity`.
  Armor weight class is derived from the AC cell (light/medium/heavy/shield),
  not the table sub-headers, which the body prose duplicates. The reconstruction
  fails closed on column drift (`EquipmentColumnMismatchError`) or an unmatched
  container (`ContainerCapacityError`) per ADR 0007 (see the file header).
- `parseMagicItems.ts` -- narrowed Magic Items A-Z text ->
  `MagicItemExtraction[]` by scanning for item category/rarity lines and walking
  backward to the item heading. Handles wrapped names/categories, `rarity
  varies`, two-column interleaving where body lines sit between a heading and
  category, and category substrings that begin after same-line prose prefixes.
  Item-specific tables/bullets remain in the parent `description`; they do not
  emit as freestanding `table` records. The real import validates the exact
  reviewed 237-name set (`EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES`).
- `emit.ts` -- extraction arrays + class index -> validated `RulesPack`,
  written deterministically (records sorted by key, fixed field order, 2-space
  indent, trailing newline).
- `index.ts` -- programmatic API + orchestrator: `runImporter({ pdfPath, outDir })`.
  Dispatches each per-kind slice to its parser.
- `cli.ts` -- command-line wrapper.

## Reference-table coverage

The table parser intentionally covers only cases whose extracted text has a
reviewed deterministic reconstruction rule. Coverage splits into table families
that are **present in the vendored SRD 5.1 source** (and therefore emitted into
the committed canonical pack) and reconstruction rules that are **wired and
tested but match no section in the SRD 5.1 PDF**. The latter emit nothing for
this source; they exist for fixtures and future editions, mirroring the retained
`hazards` / `treasureTables` section anchors (see the section-anchor notes
below). This split is the resolution of `loreweaver-46m`: the SRD 5.1 PDF
contains exactly one reconstructable reference table, so the earlier flat list
over-claimed the canonical pack's coverage.

### Present in the committed SRD 5.1 pack

| Table | Record key | Reconstruction rule |
|-------|------------|---------------------|
| Difficulty Classes | `table:difficulty-classes` | Two-column label/DC rows reconstruct cleanly from line text ("Typical Difficulty Classes", p77). |
| Trap Save DCs and Attack Bonuses | `table:trap-save-dcs-and-attack-bonuses` | Three-column danger/DC-range/attack-bonus rows reconstruct from line text (p196, gamemastering Traps section; loreweaver-hvp). Cell ranges keep the SRD en-dash verbatim. |
| Damage Severity by Level | `table:damage-severity-by-level` | Four-column level-range/setback/dangerous/deadly dice rows reconstruct from line text (p196; loreweaver-hvp). |

The committed pack holds exactly these three `table` records.
`srdGeneratedPack.test.ts` pins the table key/name set (and the per-kind
`table: 3` count) so coverage cannot silently collapse or grow without a
reviewed baseline update.

### Reconstruction-capable but absent from SRD 5.1

These are DM-reference / encounter-building tables that the Creative-Commons SRD
5.1 does **not** include (they live in non-SRD sourcebooks). The parser keeps a
reviewed reconstruction rule for each, exercised by `parseTables.test.ts` unit
fixtures and the `pipeline.test.ts` end-to-end fixture, so a future SRD edition —
or any other source — that *does* carry them is imported without new parser
work. None of them emit a record from the vendored SRD 5.1 PDF.

| Table | Record key | Reconstruction rule |
|-------|------------|---------------------|
| XP Thresholds by Character Level | `table:xp-thresholds-by-character-level` | Fixed five-column numeric threshold rows reconstruct cleanly from line text. |
| Individual Treasure challenge tables | `table:individual-treasure-challenge-<range>` | The `treasureTables` slice is wired through `runImporter`; d100 ranges form a leading block and each currency column forms an equal-length block that can be pivoted into rows. |
| Treasure Hoard challenge tables | `table:treasure-hoard-challenge-<range>` | The `treasureTables` slice is wired through `runImporter`; d100 ranges, coin columns, gems/art-object column, and magic-item column can be reconstructed from equal-length column blocks. Empty dash cells are stored as `null`. |

Tables not covered by the current parser at all:

| Table family | Reason deferred | Follow-up |
|--------------|-----------------|-----------|
| Other wide/nested DM reference tables | `loreweaver-0m9.5.13` does not claim all SRD tables. Add a dedicated anchor and reconstruction rule before emitting each additional table family; tables whose text wraps within cells may need raw pdfjs x/y positions rather than `PageText.lines` alone. | Create a follow-up from the full-PDF coverage audit with the exact table fixture. |

## Section-anchor table

The SRD 5.1 PDF is a single multi-chapter document; each kind parser is only
correct against its own chapter. `sections.ts` exposes a small table of
chapter-heading regexes that the orchestrator uses to narrow input before
dispatch. Each entry is a `SectionAnchorOptions` value:

| Field                | Purpose                                                                                              |
|----------------------|------------------------------------------------------------------------------------------------------|
| `startHeading`       | Regex matched against `line.trim()` to find the section's first content line (heading itself excluded). |
| `endHeading`         | Regex matched against any line after `startHeading` to mark the boundary (end line excluded).         |
| `requireEndHeading`  | If `true`, an unmatched `endHeading` throws `SectionNotFoundError('end')` instead of slicing to EOF.   |
| `matchHeadings`     | If `true`, anchors match only at the line positions the extractor flagged as chapter/section headings (`PageText.headingLineIndexes` — indexes into `lines`, not just heading text). Disambiguates a chapter title from a body-font line that happens to spell the same text — e.g. "Equipment" appears as a class-block subsection at body font in every base-class chapter, and a text-only check could not tell those two occurrences apart. Fixtures with uniform font sizes leave `headingLineIndexes` undefined and fall back to line matching. |

`SRD_5_1_DEFAULT_SECTION_ANCHORS` is the live table consumed by the
orchestrator. Freestanding `table` records use the `coreRules` slice for the
Difficulty Classes table, the `traps` slice for the two trap tables, and the
`treasureTables` slice for treasure challenge tables. The `traps` anchor is
best-effort on its START (a fixture without a Traps section degrades to no
traps) but `requireEndHeading: true`, so a Traps section that begins without
its `Diseases` boundary fails closed rather than letting the last trap's body
run on (the contamination loreweaver-7ok removed from Zone of Truth). Two other
anchors (`hazards`, `treasureTables`) target sections that do NOT exist in the
SRD 5.1 PDF; the orchestrator wraps those slices in a best-effort try/catch and
emits empty results when the start anchor doesn't match, so a missing canonical
section is not a run-time failure.

Real-PDF mapping note (`loreweaver-0m9.5.20`): the SRD 5.1 has no aggregate
"Classes" chapter heading; each base class is its own h=25.9 chapter title
("Barbarian" through "Wizard"). Multi-line chapter titles ("Using Ability" +
"Scores", "Appendix PH-A:" + "Conditions") are re-joined into a single
logical line by the extractor's heading-merge pass before slicing.

| Anchor key           | `startHeading`                                 | `endHeading`                                                | `requireEndHeading` | `matchHeadings` |
|----------------------|------------------------------------------------|-------------------------------------------------------------|---------------------|-----------------|
| `races`              | `/^Races$/`                                     | `/^Barbarian$\|^Classes$/`                                  | `true`              | `true`          |
| `classes`            | `/^Barbarian$\|^Classes$/`                      | `/^Beyond 1st Level$\|^Using Ability Scores$/`              | `true`              | `true`          |
| `coreRules`          | `/^Using Ability Scores$/`                      | `/^Spellcasting$\|^Spell Lists$/`                           | `true`              | `true`          |
| `spellLists`         | `/^Spell Lists$/`                              | `/^Spells$\|^Spell Descriptions$/`                          | `true`              | `true`          |
| `spellDescriptions`  | `/^Spells$\|^Spell Descriptions$/`             | `/^(Monsters\|Magic Items\|Creatures\|NPCs\|Treasure\|Appendix)\b/` | `true`        | `true`          |
| `combatActions`      | `/^Actions in Combat$/`                        | `/^(Making an Attack\|Movement and Position\|Reactions?\|Bonus Actions?\|Mounted Combat\|Underwater Combat\|Contests in Combat\|Cover)$/i` | `true` | `true` |
| `monsters`           | `/^Monsters$/`                                 | `/^(Nonplayer Characters\|NPCs\|Appendix \|Open Game License\|Legal Information)/i` | `true`     | `true`          |
| `nonplayerCharacters`| `/^Appendix MM-B:\s*Nonplayer Characters$/`    | _(none — runs to EOF)_                                       | false (best-effort start; last section) | `true` |
| `conditions`         | `/^(Appendix [A-Z]{0,3}-?[A-Z]?:?\s*)?Conditions$\|^Appendix [A-Z]{0,3}-?[A-Z]?: Conditions$/` | `/^Appendix [A-Z]{0,3}-?[A-Z]?:\|^Open Game License\|^Legal Information/i` | false (may run to EOF) | `true` |
| `feats`              | `/^Feats?$\|^Feat Descriptions?$/`             | `/^(Using Ability Scores\|...)$\|^Appendix\b/i`             | `true`              | `true`          |
| `traps`              | `/^Traps$/`                                     | `/^(Diseases\|Madness\|Objects\|Poisons\|Monsters\|Magic Items\|Appendix)\b/` | `true` (best-effort start) | `true` |
| `hazards`            | `/^Dungeon Hazards$\|^Hazards$/`               | `/^(Traps\|...)$/i`                                         | `true` (best-effort) | `true`         |
| `equipment`          | `/^Equipment$/`                                | `/^(Mounts and Vehicles\|...\|Feats)$/i`                    | `true`              | `true`          |
| `mountsAndVehicles`  | `/^Mounts and Vehicles$/`                      | `/^(Trade Goods\|Expenses\|...\|Feats)$/i`                  | false (best-effort; parser is header-bounded) | `true` |
| `magicItems`         | `/^Magic Items A-Z$/`                          | `/^(Sentient Magic Items\|Artifacts\|Monsters\|Appendix)\b/i` | `true`            | `true`          |
| `treasureTables`     | `/^Treasure$/`                                 | `/^Using (a )?Magic Items?$/i`                          | `true` (best-effort) | false          |
| `multiclassing`      | `/^Multiclassing$/`                            | `/^(Proficiencies\|...)/i`                                  | false (best-effort) | `true`         |

Anchors are deliberately tight (`^...$`) so a body-prose mention of a chapter
title can't false-positive. Tests in `test/importers/dnd5e-srd-5.1/sections.test.ts`
cover both the happy paths and the fail-closed behavior. Callers can override
the live table via the `sectionAnchors` option on `runImporter` -- useful if a
future vendored PDF uses variant heading text.

## Adding a new record kind

To add a parser for a new kind (e.g. creatures, classes, conditions):

1. **Add a new anchor entry** to `SRD_5_1_DEFAULT_SECTION_ANCHORS` in
   `sections.ts` (and to `Srd51SectionAnchors`). Pick regexes that match the
   exact chapter heading text observed in the vendored PDF. Default to
   `requireEndHeading: true` unless the section legitimately runs to EOF --
   failing closed is the whole point of the slicer.
2. **Write the kind parser** under `scripts/importers/dnd5e-srd-5.1/` (e.g.
   `parseCreatures.ts`). It must accept a narrowed `readonly PageText[]` --
   never re-slice the full PDF. The parser is responsible only for its
   chapter's grammar; the orchestrator guarantees the input doesn't span
   adjacent chapters.
3. **Wire the orchestrator**: in `runImporter` (`index.ts`), call
   `sliceSection(pages, anchors.<newKind>)` and pass the result to the new
   parser. Feed its output into `buildPack`.
4. **Update `emit.ts` / `buildPack`** if the new kind requires a new
   record-builder branch.
5. **Add tests**: unit tests for the parser (against inline SRD text excerpts,
   like `parseSpells.test.ts`), an anchor sanity test in `sections.test.ts`,
   and an end-to-end fixture page in `pipeline.test.ts` exercising the new
   slice through the orchestrator. The pipeline test should also assert that
   text from the new chapter does not bleed into adjacent kinds (and vice
   versa).
6. **Update the "Scope today" table** above when the new kind ships.

Per the `loreweaver-0m9.5` scope rule, the importer must not emit empty stubs
for kinds it does not yet cover -- landing a stub parser without real
extraction would let the generated pack pose as more complete than it is.

## Determinism

The importer is deterministic in two senses:

- **Byte-stable output**: given identical input PDF bytes, two runs produce
  byte-identical `manifest.json` + `records.json` files. `JSON.stringify`
  preserves object insertion order; the record builder uses literal field
  order; `Map.set` insertion order is also preserved.
- **Source pin**: the PDF's SHA-256 is computed and embedded in
  `manifest.json` under `source.sourceHash`, so any byte-level swap of the
  source artifact is detectable on the next run.

## Testing

- `packages/core/test/importers/dnd5e-srd-5.1/parseSpells.test.ts` -- unit
  tests for the spell parser against inline real SRD 5.1 spell text excerpts
  (used under CC-BY-4.0; attribution preserved in the test file header).
- `packages/core/test/importers/dnd5e-srd-5.1/emit.test.ts` -- emitter
  determinism: two passes over the same input produce byte-identical files;
  output passes `validateRulesPack`.
- `packages/core/test/importers/dnd5e-srd-5.1/parseTables.test.ts` -- unit
  tests for the freestanding table parser, including a two-column DC table and
  a multi-column encounter-threshold table, treasure column-block
  reconstruction, and malformed treasure blocks that must not consume later
  headings as cells.
- `packages/core/test/importers/dnd5e-srd-5.1/pipeline.test.ts` -- end-to-end
  test against a small fixture PDF generated at test time via `pdfkit`, to
  exercise the full extract -> parse -> emit pipeline without requiring the
  full SRD PDF to be present. The fixture includes a bounded treasure section
  so `runImporter` must emit both individual-treasure and treasure-hoard table
  records.
