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
| `creature`  | Implemented. Stat-block parser extracts every creature from the Monsters section into `kind=creature` records satisfying the `dnd5e-srd` creature kindSchema: `size`, `type` (subtype parenthetical dropped), `alignment`, `armorClass`, `hitPoints`, `speed` (mode→feet map; the unlabeled base speed keyed as `walk`), `challengeRating` (bare fraction/integer), and `abilityScores`. A stat block is confirmed by its size/type/alignment meta line plus the AC/HP/ability-table signature. NPC stat blocks (the separate "Nonplayer Characters" section) are intentionally out of scope. Section anchor: `monsters` (`startHeading: /^Monsters$/`, `requireEndHeading: true`). `runImporter` additionally fails closed via a creature-coverage guard: an empty Monsters parse (or a count below `minCreatureCount`, which the CLI sets to `MIN_EXPECTED_SRD_5_1_CREATURES`) throws and writes nothing. Exact name-set coverage is tracked in `loreweaver-0m9.5.14`. |
| `class`     | Implemented (base classes only). Parser keys off each base class's "Hit Dice: 1dN per <class> level" signature line and reads the labeled proficiency / saving-throw lines from its Class Features block into `kind=class` records satisfying the `dnd5e-srd` class kindSchema (`hitDie`, `armorProficiencies`, `weaponProficiencies`, `savingThrowProficiencies`, best-effort `primaryAbilities`). Section anchor: `classes` (`startHeading: /^Classes$/`, `endHeading: /^Using Ability Scores$/`, `requireEndHeading: true`). `runImporter` fails closed via a class-coverage guard (`MIN_EXPECTED_SRD_5_1_CLASSES`). Subclasses and class features are separate kinds (ADR 0009). |
| `subclass`  | Implemented. Parser extracts the 12 SRD 5.1 subclasses (one per base class: Champion, Life Domain, School of Evocation, …) from the same Classes-chapter slice by exact heading-name match into `kind=subclass` records. Each links to its parent base class via `data.parentClass` (the `class:<slug>` key — data-side linkage per ADR 0009, never `overrides`) and carries the subclass body prose in `data.description`. Base-class names bound a subclass's description so the next class's intro prose cannot bleed in. Granted features (the optional `data.features` references) are deferred to the feature parser (`loreweaver-0m9.5.18`). |
| `background`| SRD 5.1 does not publish backgrounds; see ADR 0005. |
| `ancestry`  | Implemented. Parser extracts the SRD 5.1 races and subraces by known-name match into `kind=ancestry` records (`data.source = 'race'` per ADR 0005). Parents and subraces are **separate records**; each subrace record is **flattened/self-contained** — its `data.traits` merge the parent's shared traits with the subrace's own additions, with `data.subraceOf` back-referencing the parent and the parent's `data.subraces` listing its children (no `overrides`). Section anchor: `races` (`startHeading: /^Races$/`, `endHeading: /^Classes$/`, `requireEndHeading: true`). |
| `equipment` | Implemented. Parser projects the Equipment chapter's three tables into per-item `kind=equipment` records: weapons (`damageDie`, `damageType`, `properties[]`), armor (`ac`, `armorType`, `stealthDisadvantage`, optional `strengthRequirement`), and adventuring gear. All carry `category` plus verbatim `cost`/`weight`. Section anchor: `equipment` (`startHeading: /^Equipment$/`, `requireEndHeading: true`). Assumes row-major table extraction; see `parseEquipment.ts`. |
| `feat`      | Implemented. Parser extracts feat entries (SRD 5.1: Grappler) with optional prerequisites and description text in `data.description`. Section anchor: `feats` (`startHeading: /^Feats?$\|^Feat Descriptions?$/`, `requireEndHeading: true`). |
| `condition` | Implemented. Parser extracts all 15 SRD conditions (blinded, charmed, deafened, exhaustion, frightened, grappled, incapacitated, invisible, paralyzed, petrified, poisoned, prone, restrained, stunned, unconscious). Exhaustion carries a structured `levels` array (6 entries). Section anchor: `conditions` (`startHeading: /^Appendix A: Conditions$\|^Conditions$/`). |
| `hazard`    | Implemented. Parser extracts the 4 SRD 5.1 environmental hazards by exact name match (Brown Mold, Green Slime, Webs, Yellow Mold). Each record carries a `description` field with re-flowed prose. Section anchor: `hazards` (`startHeading: /^Dungeon Hazards$\|^Hazards$/`, `requireEndHeading: true`). |
| `table`     | Implemented for Difficulty Classes, XP Thresholds by Character Level, and SRD treasure challenge tables emitted as interleaved column blocks. `loreweaver-0m9.5.13` wires those treasure tables through `runImporter`; broader table completeness remains the responsibility of the full-PDF coverage audit. |
| `rule`      | Implemented. Parser extracts labeled rule-text sections from the SRD core-rules chapters (e.g., Cover, Resting) and stores full body text in `data.text`. Section anchor: `coreRules` (`startHeading: /^Using Ability Scores$/`, `endHeading: /^Spell Lists$/`, `requireEndHeading: true`). |

The importer does **not** emit empty stubs for unimplemented kinds. Per the
ADR 0007 ingestion policy and the `loreweaver-0m9.5` scope rule, a generated
pack that omits a kind reflects "the parser doesn't cover that yet" -- not "the
SRD doesn't contain those records". The generated manifest's `description`
field lists the included kinds explicitly so downstream callers can tell.

## How to regenerate

1. Vendor the SRD 5.1 PDF at `packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf`
   -- see that directory's `README.md` for the source URL and license posture.
2. From the repo root:

   ```bash
   npm run import:dnd5e-srd
   ```

   This runs against the default vendored PDF path and writes to a scratch
   directory at `packages/core/scripts/importers/dnd5e-srd-5.1/.generated/`.
   It does NOT overwrite the canonical pack location.

3. Inspect the output. If you intend to publish the regenerated pack:

   ```bash
   npm run import:dnd5e-srd -- --out packages/core/data/rules-packs/rules__dnd5e-srd-5.1
   ```

   Today this is only appropriate when the importer's parser coverage is broad
   enough that the resulting pack is reference-complete. Until then,
   overwriting the canonical pack drops the existing seed records without
   replacing them with full SRD coverage.

The CLI prints the source PDF's SHA-256 on each run. Record that value in
`packages/core/sources/dnd5e-srd-5.1/README.md` as the **Expected SHA-256** so
future runs can detect a swapped artifact.

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
- `parseCreatures.ts` -- narrowed Monsters-section text -> `CreatureExtraction[]`
  by scanning for each stat block's size/type/alignment meta line, validating
  the type against the 14 SRD creature types, then reading the keyed stat lines
  (Armor Class, Hit Points, Speed, the STR/DEX/… ability table, Challenge). A
  meta-like sentence without the AC/HP/ability signature is skipped; a
  confirmed block missing Speed or Challenge throws.
- `parseConditions.ts` -- narrowed text -> `ConditionExtraction[]` by exact
  match against the 15 known condition names. Bullet-point lines become
  `effects[]`; exhaustion's level table becomes a structured `levels[]` array.
- `parseHazards.ts` -- narrowed text -> `HazardExtraction[]` by exact match
  against the 4 known SRD 5.1 hazard names (Brown Mold, Green Slime, Webs,
  Yellow Mold). Body is re-flowed prose paragraphs.
- `parseRules.ts` -- narrowed core-rules text -> `RuleExtraction[]` by
  heading-style section labels (e.g. Cover, Resting). Body is re-flowed prose
  in `text`.
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
- `parseTables.ts` -- narrowed core-rules and treasure-table text ->
  `TableExtraction[]` by per-table anchors plus conservative row
  reconstruction for simple reference tables and column-block reconstruction
  for SRD treasure tables. Rows are emitted as structured arrays in
  `data.rows`.
- `parseEquipment.ts` -- narrowed Equipment-chapter text ->
  `EquipmentExtraction[]` via a state machine keyed on the three table titles
  (Weapons, Armor, Adventuring Gear) and their sub-headers. Each row is
  projected into a per-item record with category-specific structured fields.
  Assumes row-major table extraction (one line per item row).
- `emit.ts` -- `SpellExtraction[]` + class index + `ConditionExtraction[]` +
  `HazardExtraction[]` + `ActionExtraction[]` + `RuleExtraction[]` +
  `TableExtraction[]` + `EquipmentExtraction[]` -> validated `RulesPack`,
  written deterministically (records sorted by key, fixed field order, 2-space
  indent, trailing newline).
- `index.ts` -- programmatic API + orchestrator: `runImporter({ pdfPath, outDir })`.
  Dispatches each per-kind slice to its parser.
- `cli.ts` -- command-line wrapper.

## Reference-table coverage

The table parser intentionally covers only cases whose extracted text has a
reviewed deterministic reconstruction rule:

| Table | Record key | Reason it is covered |
|-------|------------|----------------------|
| Difficulty Classes | `table:difficulty-classes` | Two-column label/DC rows reconstruct cleanly from line text. |
| XP Thresholds by Character Level | `table:xp-thresholds-by-character-level` | Fixed five-column numeric threshold rows reconstruct cleanly from line text. |
| Individual Treasure challenge tables | `table:individual-treasure-challenge-<range>` | The `treasureTables` slice is wired through `runImporter`; d100 ranges form a leading block and each currency column forms an equal-length block that can be pivoted into rows. |
| Treasure Hoard challenge tables | `table:treasure-hoard-challenge-<range>` | The `treasureTables` slice is wired through `runImporter`; d100 ranges, coin columns, gems/art-object column, and magic-item column can be reconstructed from equal-length column blocks. Empty dash cells are stored as `null`. |

Tables not covered by the current parser:

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

`SRD_5_1_DEFAULT_SECTION_ANCHORS` is the live table consumed by the
orchestrator. Today it covers ten slices. Freestanding `table` records use
the `coreRules` slice for simple reference tables and the `treasureTables`
slice for treasure challenge tables.

| Anchor key           | `startHeading`                                 | `endHeading`                                                | `requireEndHeading` |
|----------------------|------------------------------------------------|-------------------------------------------------------------|---------------------|
| `races`              | `/^Races$/`                                     | `/^Classes$/`                                               | `true`              |
| `coreRules`          | `/^Using Ability Scores$/`                     | `/^Spell Lists$/`                                           | `true`              |
| `spellLists`         | `/^Spell Lists$/`                              | `/^Spells$\|^Spell Descriptions$/`                          | `true`              |
| `spellDescriptions`  | `/^Spells$\|^Spell Descriptions$/`             | `/^(Monsters\|Magic Items\|Creatures\|NPCs\|Treasure\|Appendix)$/` | `true`              |
| `combatActions`      | `/^Actions in Combat$/`                        | `/^(Making an Attack\|Movement and Position\|Reactions?\|Bonus Actions?\|Mounted Combat\|Underwater Combat\|Contests in Combat\|Cover)$/i` | `true` |
| `monsters`           | `/^Monsters$/`                                 | `/^(Nonplayer Characters\|NPCs\|Appendix\|Open Game License\|Legal Information)\b/i` | `true`              |
| `conditions`         | `/^Appendix A: Conditions$\|^Conditions$/`     | `/^Appendix [B-Z]:\|^Open Game License\|^Legal Information\|^Monster (Statistics\|Lists?)$/i` | false (may run to EOF) |
| `feats`              | `/^Feats?$\|^Feat Descriptions?$/`             | `/^(Using Ability Scores\|Adventuring\|Combat\|Equipment\|Monsters\|Magic Items\|Running the Game\|Chapter \d+\|Spell Lists?)$\|^Appendix\b/i` | `true` |
| `hazards`            | `/^Dungeon Hazards$\|^Hazards$/`               | `/^(Traps\|Sample Traps\|Wilderness Hazards\|Monsters\|Magic Items\|Appendix\|Chapter \d+\|Open Game License\|Legal Information)$/i` | `true` |
| `equipment`          | `/^Equipment$/`                                | `/^(Mounts and Vehicles\|Trade Goods\|Expenses\|Trinkets\|Multiclassing\|Spellcasting\|Using Ability Scores\|Adventuring\|Combat\|Monsters\|Magic Items\|Chapter \d+)$/i` | `true` |
| `treasureTables`     | `/^Treasure$/`                                 | `/^Using (a )?Magic Items?$/i`                          | `true`              |

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
