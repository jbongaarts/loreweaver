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
| `condition` | Not implemented. Child of `loreweaver-0m9.5`. |
| `hazard`    | Not implemented. Child of `loreweaver-0m9.5`. |
| `table`     | Not implemented. Child of `loreweaver-0m9.5`. |
| `rule`      | Not implemented. Child of `loreweaver-0m9.5`. |

The importer does **not** emit empty stubs for unimplemented kinds. Per the
ADR 0007 ingestion policy and the `loreweaver-0m9.5` scope rule, a generated
pack that omits a kind reflects "the parser doesn't cover that yet" — not "the
SRD doesn't contain those records". The generated manifest's `description`
field lists the included kinds explicitly so downstream callers can tell.

## How to regenerate

1. Vendor the SRD 5.1 PDF at `packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf`
   — see that directory's `README.md` for the source URL and license posture.
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
        │
        ▼  extract.ts (pdfjs-dist)
   PageText[]
        │
        ▼  parseSpells.ts
   SpellExtraction[]  +  SpellClassIndex
        │
        ▼  emit.ts
   RulesPack  (validated by validateRulesPack)
        │
        ▼
   manifest.json + records.json
```

- `extract.ts` — PDF → per-page text via `pdfjs-dist`. Groups text items by
  y-coordinate (with rounding) and sorts each line left-to-right. Pure
  function over the PDF buffer.
- `parseSpells.ts` — text → `SpellExtraction[]` by scanning for level-school
  marker lines, then walking backward for the name and forward for keyed
  metadata + description. Class lists are a second pass.
- `emit.ts` — `SpellExtraction[]` + class index → validated `RulesPack`,
  written deterministically (records sorted by key, fixed field order,
  2-space indent, trailing newline).
- `index.ts` — programmatic API: `runImporter({ pdfPath, outDir })`.
- `cli.ts` — command-line wrapper.

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

- `packages/core/test/importers/dnd5e-srd-5.1/parseSpells.test.ts` — unit
  tests for the spell parser against inline real SRD 5.1 spell text excerpts
  (used under CC-BY-4.0; attribution preserved in the test file header).
- `packages/core/test/importers/dnd5e-srd-5.1/emit.test.ts` — emitter
  determinism: two passes over the same input produce byte-identical files;
  output passes `validateRulesPack`.
- `packages/core/test/importers/dnd5e-srd-5.1/pipeline.test.ts` — end-to-end
  test against a small fixture PDF generated at test time via `pdfkit`, to
  exercise the full extract → parse → emit pipeline without requiring the
  full SRD PDF to be present.
