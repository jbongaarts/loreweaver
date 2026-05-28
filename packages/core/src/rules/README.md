# `rules/` — Rules-Pack Subsystem

This directory owns everything related to the cross-system rules-pack model:
the type definitions, validators, loaders, in-memory base-pack constants, and
the legacy SRD catalog that those constants depend on.

## Pack model (source files)

| File | Responsibility |
|------|---------------|
| `types.ts` | Core types for `RulesPack`, `RulesRecord`, `RulesPackMeta`, `RulesPackLicense`, `RecordProvenance`, and related shapes |
| `kindSchemas.ts` | Zod schemas for each record kind; used by the validator and importer pipeline |
| `validate.ts` | Deterministic pack validator — checks structural correctness and license completeness of a `RulesPack` |
| `license.ts` | License helper utilities shared across pack loading and validation |
| `packLoader.ts` | On-disk pack loader: `loadRulesPackFromDirectory` reads `manifest.json` + `records.json` from a pack directory |
| `stack.ts` | Rules-pack stack resolver — merges an ordered list of packs for a campaign, applying override semantics |
| `lookup.ts` | `lookupRulesRecord`: typed lookup across a resolved pack stack by kind, key, or name |
| `binding.ts` | Campaign-to-pack binding model: `readCampaignRulesBinding`, `DEFAULT_DND5E_SRD_BINDING` |

## In-memory base-pack constants

`dnd5eSrd.ts` and `pathfinder2eRemaster.ts` are hand-authored fixtures that
export a fully constructed `RulesPack` constant for use without disk I/O.

These fixtures are **temporary**. They will be replaced by deterministic
importers tracked in epic `loreweaver-0m9`:

- `dnd5eSrd.ts` — targeted for replacement by the 0m9.5 D&D 5e SRD importer.
  The importer foundation + spell parser ship under `loreweaver-0m9.5`; see
  `packages/core/scripts/importers/dnd5e-srd-5.1/` and that directory's
  `README.md` for the current parser coverage and regeneration procedure.
  Until parser coverage is broad enough to be reference-complete, the
  importer writes to a scratch path by default and `dnd5eSrd.ts` continues to
  wrap the legacy SRD catalog in `srd/` (see below).
- `pathfinder2eRemaster.ts` — targeted for replacement by the 0m9.8
  Pathfinder 2e Remaster importer.

## Legacy SRD catalog (`srd/`)

`rules/srd/` holds a small hand-authored D&D 5e SRD 5.1 reference catalog:

| File | Contents |
|------|----------|
| `srd/types.ts` | `SrdKind`, `SrdRecord` union, `SrdCatalog`, `SrdLookupInput`, `SrdLookupResult`, `SrdLicenseMetadata` |
| `srd/data.ts` | `SRD_CATALOG` (seed records for monsters, spells, and classes) and `SRD_LICENSE` |
| `srd/store.ts` | `buildSrdIndex`, `lookupSrdRecord` — builds a ref/name index over a catalog and performs lookups |

This catalog predates the rules-pack model. Today it is consumed by two
callers:

- `characterCreation.ts` — uses `lookupSrdRecord` and `SRD_CATALOG` for D&D
  class/spell draft validation during character creation.
- `rules/dnd5eSrd.ts` — wraps `SRD_CATALOG` and `SRD_LICENSE` into the
  `DND5E_SRD_RULES_PACK` constant.

`srd/` is placed under `rules/` (rather than as a top-level peer of `rules/`)
so it no longer appears to be a parallel subsystem. It is not part of the
stable public API. When the 0m9.5 importer lands and `characterCreation.ts`
migrates to `lookupRulesRecord`, this catalog will be retired.

## Generated/seed pack data on disk

On-disk pack data lives at:

```
packages/core/data/rules-packs/<packId-safe>/manifest.json
packages/core/data/rules-packs/<packId-safe>/records.json
```

The `<packId-safe>` convention replaces `:` with `__` (e.g. `rules:dnd5e-srd`
becomes `rules__dnd5e-srd`). This directory is the authoritative target for
packs produced by the 0m9 importers. `packLoader.ts` loads it via
`loadRulesPackFromDirectory`.

## Ingestion policy

See `docs/adr/0007-rules-pack-ingestion-policy.md` for what model-assisted
generation is permitted during pack ingestion.
