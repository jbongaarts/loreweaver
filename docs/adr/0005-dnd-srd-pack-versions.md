# ADR 0005: D&D SRD Pack Versions

Status: accepted

Date: 2026-05-25

## Context

The deterministic rules-pack ingestion pipeline (beads epic
`loreweaver-0m9`) replaces the small hand-coded D&D 5e SRD fixture in
`packages/core/src/rules/dnd5eSrd.ts` with importer-generated rules
records. Before the importer (`loreweaver-0m9.5`) can be implemented, the
target SRD version must be explicit and the scope/license posture
documented.

Two open SRD baselines are realistically importable today:

- **SRD 5.1** (Wizards of the Coast LLC, released January 2023 under
  CC-BY-4.0). This is the canonical "fifth edition" reference text the
  current fixture already cites and that most of the existing community
  ecosystem (Foundry data packs, third-party tooling, etc.) speaks.
- **SRD 5.2** (Wizards of the Coast LLC, released 2025 under CC-BY-4.0).
  Tracks the 2024 rules updates (revised classes, spells, monsters,
  conditions, and exploration/social rules) and supersedes 5.1 for groups
  that adopted the 2024 books.

A third option — older SRDs under the OGL 1.0a (3.5 / 5.0 — never released
as 5.0 SRD; 3.5 SRD only) — is not in scope for this ADR. The OGL 1.0a
de-authorization episode in early 2023 made OGL-only content riskier than
the CC-BY-4.0 corpora above, and the rules-pack policy
(`loreweaver-0m9.11`) requires a clean open-license baseline for
authoritative content.

## Decision

Eshyra ships D&D SRD 5.1 and D&D SRD 5.2 as **two independent base
rules packs**. Campaigns pin to one of them via the existing rules
binding. No automatic upgrade or merging between the two — a 5.1 campaign
stays on 5.1 unless the user explicitly rebinds.

### Pack identities

| Pack | `packId` | `meta.source.sourceVersion` | `meta.version` |
| --- | --- | --- | --- |
| SRD 5.1 | `rules:dnd5e-srd-5.1` | `5.1` | `5.1` |
| SRD 5.2 | `rules:dnd5e-srd-5.2` | `5.2` | `5.2` |

Both packs share `meta.systemId = "dnd5e-srd"` so that add-on packs and
campaigns can declare compatibility against either base without inventing
two separate system identities. `meta.compatibleBaseSystems` on add-on
packs lists the supported `version` values explicitly.

The existing fixture's pack id (`rules:dnd5e-srd`) is renamed to
`rules:dnd5e-srd-5.1` as part of the SRD 5.1 importer in
`loreweaver-0m9.5`. There is no on-disk user data to migrate (Eshyra
has no released installations — see ADR 0003 §"no migration path"), so
the rename is a code change only.

### Import scope

For each pack, the importer ingests all rules elements actually present
in the published SRD document:

- Creatures / monsters / NPCs (block-stat form).
- Spells (full mechanical effect text plus components, range, duration,
  level, school, class lists).
- Classes, subclasses, and class features.
- Backgrounds (5.2 only — 5.1 does not include backgrounds in the SRD).
- Ancestries / species (5.2 only — 5.1's SRD has races; 5.2 publishes
  them as species; the importer normalizes to the `RulesRecordKind`
  value `ancestry` while preserving the source term in record `data`).
- Equipment / items / weapons / armor.
- Conditions.
- Feats.
- Hazards / traps where present.
- Reference tables (encounter, treasure, exhaustion, etc.).
- General rule text the SRD designates as part of the rules text
  (`kind: 'rule'`).

The importer must round-trip every rules element in the source. Coverage
tests in `loreweaver-0m9.6` assert this.

### Attribution and license metadata

Both packs carry the existing `RulesPackLicense` shape with
`licenseClass: 'open'` and the SRD's required attribution text. The
pack-level `RulesPackSource` block uses:

- `sourceTitle`: "System Reference Document 5.1" / "System Reference
  Document 5.2".
- `sourceVersion`: `5.1` / `5.2`.
- `sourceUrl`: the canonical Wizards URL for the published artifact.
- `sourceHash`: SHA-256 of the vendored source artifact (per ADR
  policy in `loreweaver-0m9.11`; the source corpus is vendored in-repo
  per the project decision recorded in beads `loreweaver-0m9` session
  notes 2026-05-25).
- `sourceDate`: ISO date of the published artifact.
- `recordProvenancePolicy`: "Every record names the SRD page or section
  it was extracted from; pageless records use the SRD section as the
  locator."

### Excluded categories

The SRDs by design exclude:

- Forgotten Realms, Greyhawk, and other published-setting content.
- Adventure modules.
- Trade dress (covers, layout, branded art).
- Compatibility logos and the "fifth edition" / "Dungeons & Dragons"
  trademarks themselves.

The importer must not extract any of the above even if the source
artifact happens to render them (e.g. cover pages). The pack-level
`license.containsTrademarkedSettingMaterial` stays `false` and audit
tests enforce that.

In addition, this ADR explicitly excludes — from both 5.1 and 5.2 packs —
any author commentary, designer notes, or front-matter prose that is not
part of the rules text proper. Those are not authoritative rules content
and including them inflates pack size without serving rules lookup.

## Consequences

- Two SRD packs ship in `@eshyra/core` and load through the new pack
  loader (`loreweaver-0m9.3`).
- The current fixture's records flow into the 5.1 pack only; the 5.2
  pack starts empty until the 5.2 importer runs.
- The existing pack id `rules:dnd5e-srd` is replaced. No on-disk user
  data needs migration.
- Add-on packs (third-party or future first-party) target one or both
  versions via `meta.compatibleBaseSystems[].versions`.
- Coverage tests (`loreweaver-0m9.6`) assert distinct expected counts per
  version because 5.2 differs in record presence (e.g. backgrounds) and
  in some record contents (e.g. revised conditions).

## Rejected Alternatives

- **Ship only SRD 5.2.** Rejected: 5.1 is the version most third-party
  community data targets today and is a stable baseline we can compare
  the 5.2 importer against. Dropping 5.1 strands existing 5e content.
- **Ship only SRD 5.1.** Rejected: 5.2 is the live SRD going forward and
  carries the 2024 rules revisions. Tying Eshyra to 5.1 ages out
  quickly.
- **Ship a single merged "latest SRD" pack.** Rejected: the two SRDs are
  not strictly upward-compatible. Some records change semantics between
  5.1 and 5.2 (revised classes/conditions). Merging them silently would
  let a 5.1 campaign drift into 5.2 behavior unannounced.
- **Ingest OGL 1.0a-licensed material (3.5 SRD or third-party 5e
  references).** Rejected for this ADR: OGL-1.0a content carries
  license risk post-de-authorization and is incompatible with the
  open-license-first policy in ADR 0001. A separate ADR can revisit if
  needed.
