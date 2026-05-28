# D&D 5e SRD 5.1 Importer

Deterministic extractor for the D&D 5th Edition System Reference Document 5.1
(CC-BY-4.0). Reads a vendored PDF, extracts canonical `RulesRecord`s, and
writes a `manifest.json` + `records.json` pair compatible with
`loadRulesPackFromDirectory`.

Tracked work: beads `loreweaver-0m9.5` (foundation + spell parser this
session; remaining kinds are child issues).

## Scope today

| Record kind | Status |
|-------------|--------|
| `spell`     | Implemented. Stat-block parser extracts name, level, school, ritual flag, casting time, range, components (incl. material text), duration, description, and "At Higher Levels" upcast text. Class lists are cross-referenced from the class-spell-list section. |
| `creature`  | Not implemented. Child of `loreweaver-0m9.5`. |
| `class`     | Not implemented. Child of `loreweaver-0m9.5`. |
| `background`| SRD 5.1 does not publish backgrounds; see ADR 0005. |
| `ancestry`  | SRD 5.1 publishes races, not species. Tracked as a child kind under `loreweaver-0m9.5`. |
| `equipment` | Not implemented. Child of `loreweaver-0m9.5`. |
| `feat`      | Not implemented. Child of `loreweaver-0m9.5`. |
| `condition` | Implemented. Parser extracts all 15 SRD conditions (blinded, charmed, deafened, exhaustion, frightened, grappled, incapacitated, invisible, paralyzed, petrified, poisoned, prone, restrained, stunned, unconscious). Exhaustion carries a structured `levels` array (6 entries). Section anchor: `conditions` (`startHeading: /^Appendix A: Conditions$|^Conditions$/`). |
| `hazard`    | Implemented. Parser extracts the 4 SRD 5.1 environmental hazards by exact name match (Brown Mold, Green Slime, Webs, Yellow Mold). Each record carries a `description` field with re-flowed prose. Section anchor: `hazards` (`startHeading: /^Dungeon Hazards$\|^Hazards$/`, `requireEndHeading: false`). |
| `table`     | Not implemented. Child of `loreweaver-0m9.5`. |
| `rule`      | Not implemented. Child of `loreweaver-0m9.5`. |

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
- `parseConditions.ts` -- narrowed text -> `ConditionExtraction[]` by exact
  match against the 15 known condition names. Bullet-point lines become
  `effects[]`; exhaustion's level table becomes a structured `levels[]` array.
- `parseHazards.ts` -- narrowed text -> `HazardExtraction[]` by exact match
  against the 4 known SRD 5.1 hazard names (Brown Mold, Green Slime, Webs,
  Yellow Mold). Body is re-flowed prose paragraphs.
- `emit.ts` -- `SpellExtraction[]` + class index + `ConditionExtraction[]` + `HazardExtraction[]` -> validated `RulesPack`,
  written deterministically (records sorted by key, fixed field order,
  2-space indent, trailing newline).
- `index.ts` -- programmatic API + orchestrator: `runImporter({ pdfPath, outDir })`.
  Dispatches each per-kind slice to its parser.
- `cli.ts` -- command-line wrapper.

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
orchestrator. Today it covers five slices:

| Anchor key           | `startHeading`                                 | `endHeading`                                                | `requireEndHeading` |
|----------------------|------------------------------------------------|-------------------------------------------------------------|---------------------|
| `spellLists`         | `/^Spell Lists$/`                              | `/^Spells$\|^Spell Descriptions$/`                          | `true`              |
| `spellDescriptions`  | `/^Spells$\|^Spell Descriptions$/`             | `/^(Monsters\|Magic Items\|Creatures\|NPCs\|Treasure\|Appendix)$/` | `true`              |
| `conditions`         | `/^Appendix A: Conditions$\|^Conditions$/`     | `/^Appendix [B-Z]:\|^Open Game License\|^Legal Information\|^Monster (Statistics\|Lists?)$/i` | false (may run to EOF) |
| `feats`              | `/^Feats?$\|^Feat Descriptions?$/`             | `/^(Using Ability Scores\|Adventuring\|Combat\|Equipment\|Monsters\|Magic Items\|Running the Game\|Chapter \d+\|Spell Lists?)$\|^Appendix\b/i` | `true` |
| `hazards`            | `/^Dungeon Hazards$\|^Hazards$/`               | `/^(Traps\|Sample Traps\|Wilderness Hazards\|Monsters\|Magic Items\|Appendix\|Chapter \d+\|Open Game License\|Legal Information)$/i` | false (safe: exact-name matching prevents bleed) |

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
- `packages/core/test/importers/dnd5e-srd-5.1/pipeline.test.ts` -- end-to-end
  test against a small fixture PDF generated at test time via `pdfkit`, to
  exercise the full extract -> parse -> emit pipeline without requiring the
  full SRD PDF to be present.
