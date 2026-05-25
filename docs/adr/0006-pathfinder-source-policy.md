# ADR 0006: Pathfinder Source Policy and Allowed Corpus

Status: accepted

Date: 2026-05-25

## Context

The deterministic rules-pack ingestion pipeline (beads epic
`loreweaver-0m9`) replaces the small hand-coded Pathfinder 2e Remaster
fixture in `packages/core/src/rules/pathfinder2eRemaster.ts` with
importer-generated rules records. Before the importer
(`loreweaver-0m9.8`) can be implemented, the source policy must be
explicit: what Pathfinder material may be ingested, under which license,
and what must stay reference-only.

Pathfinder's licensing changed materially between 2023 and 2024:

- **Pathfinder 2e Remaster** (Player Core, GM Core, Monster Core, Player
  Core 2, and subsequent Remaster releases) is published by Paizo under
  the **Open RPG Creative License (ORC)**. The Remaster rewrote elements
  of Pathfinder 2e to remove Open Game License 1.0a dependencies and to
  re-license the rules text under ORC.
- **Pre-Remaster Pathfinder 2e** (Core Rulebook, GM Guide, Bestiary 1–3
  etc., 2019–2023) was published under OGL 1.0a. Paizo continues to
  honor those releases but the strategic line going forward is ORC-only.
- **Pathfinder 1e** is OGL 1.0a content with additional product-identity
  carve-outs (Paizo's Community Use Policy).
- **Adventure paths, lore, and setting material** (Golarion, organized
  play, named NPCs, place names) live behind Paizo's Community Use
  Policy. They are not part of the ORC corpus and are not safe for
  direct redistribution.

The current fixture cites Remaster reference material under ORC, which
is the right baseline. This ADR makes that baseline explicit and lists
exactly which sources are allowed, reference-only, or excluded.

## Decision

The bundled Pathfinder rules pack is built only from **Pathfinder 2e
Remaster** sources released under the ORC license. No OGL-1.0a content,
no Community-Use-Policy content, no adventure-path content.

### Allowed corpus (ingestable into the bundled pack)

| Source                                | License | Pack content                                                                                                                     |
| ------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Pathfinder Player Core                | ORC     | Ancestries, backgrounds, classes (Player Core list), class feats, general feats, equipment, spells, conditions, core rules text. |
| Pathfinder GM Core                    | ORC     | Hazards, environments, rewards/treasure tables, GM-facing rules text, conditions delta if any.                                   |
| Pathfinder Monster Core               | ORC     | Creatures / monsters.                                                                                                            |
| Pathfinder Player Core 2              | ORC     | Additional ancestries, classes, feats, spells, equipment as published.                                                           |
| Future ORC-licensed Remaster releases | ORC     | Same rules-element kinds as above, added in subsequent pack versions.                                                            |

All ingested records must come from the published ORC text. Importer
output is deterministic and reproducible from the source artifact.

### Reference-only sources (not ingested)

These sources may be consulted by humans developing parsers or audit
heuristics, but **must not** become authoritative pack content:

- **Archives of Nethys.** Paizo's official online compendium. Useful as
  a structural reference and for spot-checking importer output, but not
  treated as an ORC-licensed source artifact itself — the authoritative
  source is the published Remaster volume. Where Archives surfaces
  pre-Remaster text alongside Remaster text, the importer must select
  the Remaster variant.
- **Third-party Pathfinder 2e SRD sites** (Foundry data packs, community
  compendia, wiki ports). Even when ORC-mirroring, their normalization
  decisions are not authoritative. Use only as structural cross-checks.
- **Pathfinder Infinite community publications.** Paizo's
  community-publishing storefront — license posture varies per work and
  is not a bulk-importable corpus.

### Excluded categories (never ingested into the bundled pack)

- **Pre-Remaster Pathfinder 2e** material under OGL 1.0a, including the
  2019 Core Rulebook, Bestiaries 1–3, GMG, and Advanced Player's Guide.
  Where Remaster reissues a previously-OGL element under ORC, only the
  Remaster version is ingestable.
- **Pathfinder 1e** material under OGL 1.0a.
- **Pathfinder Lost Omens setting line** (Lost Omens World Guide,
  Character Guide, Gods & Magic, etc.) — Community Use Policy, not ORC.
- **Adventure paths and modules** — Community Use Policy, not ORC.
- **Trademarked terms and trade dress** — "Pathfinder", organized-play
  brand marks, Paizo logos, named setting elements (Golarion, named
  deities, named locations, named NPCs from APs).
- **Author commentary, designer notes, and front matter** that is not
  part of the rules text proper.

The pack-level `license.containsTrademarkedSettingMaterial` stays
`false` and audit tests (`loreweaver-0m9.9`) enforce that the importer's
output contains no excluded terms.

### Separation of rules from setting / adventure content

The bundled Pathfinder pack contains **mechanics only**. Specifically:

- Ancestry records describe traits, ability boosts, hit points, speeds,
  size, languages, and ancestry feats. They do not include
  Golarion-specific cultural lore even when the source volume frames an
  ancestry through that lens.
- Class records describe proficiency progressions, class features, and
  class feats. They do not include in-world organization, named NPCs,
  or named historical events.
- Spell, equipment, condition, hazard, and creature records carry only
  the mechanical block, the descriptive text published in the ORC
  rules-text portion of the source, and the trait keywords. Any
  Golarion-specific flavor sidebars stay out.

When the source volume tags a record as "uncommon" or "rare" with
in-world rationale ("the Bellflower Network teaches this"), the importer
preserves the rarity tag but does not import the in-world rationale.

### License and provenance metadata

Both bundled Pathfinder pack revisions carry the `RulesPackLicense`
shape with:

- `licenseClass: 'open'`
- `licenseName`: "Open RPG Creative License (ORC)"
- `requiresAttribution: true`, with `attributionText` listing the ORC
  attribution text and naming each Remaster volume that contributed
  records.
- `containsTrademarkedSettingMaterial: false`.
- `outputRestrictions`: "Preserve ORC attribution on redistributed
  records. Do not include Paizo trade dress, compatibility logos, or
  reserved setting material."

`RulesPackSource.sourceTitle` lists the contributing Remaster volumes;
`sourceVersion` matches the Remaster printing version; `sourceHash` is
the SHA-256 of the vendored source artifact; `sourceIdentity` is used
rather than `sourceUrl` because the source corpus is vendored in-repo
per the project decision recorded in beads `loreweaver-0m9` session
notes 2026-05-25.

## Consequences

- The bundled Pathfinder pack is ORC-only. No OGL-era Pathfinder content
  enters the bundle, even where mechanics overlap.
- A user who wants pre-Remaster mechanics must supply their own
  user-private pack (`licenseClass: 'user-private'`), which is then
  excluded from public/shippable pack policy.
- The existing `pathfinder2eRemaster.ts` fixture's stand-in records are
  replaced by importer output in `loreweaver-0m9.8`. Pack id stays
  `rules:pathfinder2e-remaster` and version increments per Remaster
  printing.
- Audit tests (`loreweaver-0m9.9`) include a denylist of
  setting/trademark terms that must not appear in record content.
- Future Paizo Remaster releases extend the pack version rather than
  spawning a parallel pack: the Remaster line is intended as
  forward-compatible mechanics, unlike the SRD 5.1/5.2 split in
  ADR 0005.

## Rejected Alternatives

- **Ingest pre-Remaster Pathfinder 2e under OGL 1.0a.** Rejected: the
  OGL-1.0a de-authorization episode in early 2023 raised the license
  risk of OGL-only corpora and conflicts with the open-license-first
  policy in ADR 0001. The Remaster covers the same mechanical surface
  under cleaner terms.
- **Treat Archives of Nethys as the authoritative source artifact.**
  Rejected: Archives is a compendium / mirror, not a single
  versionable ORC release. Vendoring the published Remaster volumes
  gives a stable hash and a single ORC attribution chain.
- **Bundle Lost Omens or Adventure Path content alongside rules.**
  Rejected: those sit under Community Use Policy, not ORC. Bundling
  them risks misrepresenting their license and pollutes the
  rules-mechanics surface with setting flavor.
- **Skip Pathfinder entirely until a public-domain alternative
  exists.** Rejected: ORC is a working open license today and Paizo's
  Remaster is the canonical ORC ruleset. Waiting forfeits a real
  second-system option for users.
