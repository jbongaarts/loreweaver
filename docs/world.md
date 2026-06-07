# World Subsystem (E2)

The world subsystem turns an authored **module pack** into a per-campaign
template, then resolves live divergence from that template at read time. It
keeps campaign/module content separate from rules (E1), canonical live state
(E3), and generated memory (E4).

## Module pack schema

A pack is a single validated `ModulePack` (`packages/core/src/world/types.ts`):

- `meta` — `packId`, `title`, `packType`, `description`,
  `startingLocationId`, a `license` block, and a `rulesRequirements` block
  naming the base rules system and any required add-on packs.
- `locations[]` — id, prose, `exits[]` (direction → location), and
  `encounterIds` / `npcIds` / `tags`.
- `encounters[]` — creatures referenced by provider-neutral `rulesRef` into
  the campaign's resolved rules stack (stat blocks are not copied into the
  pack).
- `npcs[]` — role, location, disposition, public summary, DM-only `secret`.
- `triggers[]` — advisory plot-advancement beats (`when` / `effect` / `once`);
  they describe progression, they do not write state.
- `lore[]` — `public` or `dm`-scoped background entries.

`validateModulePack(value)` structurally validates untrusted input and enforces
referential integrity: ids are unique within a kind, `startingLocationId`
resolves to a location, and every exit points at a real location. It throws
`WorldModuleError` on the first problem. `loadModuleFromDir(dir)` reads
`<dir>/module.json` read-only and validates it, so authored files stay pristine
and a campaign can be re-forked.

## License and allowed-use metadata

`meta.license` (`PackLicense`) carries the policy fields from the content
strategy: `licenseClass`, attribution, and the `*Allowed` booleans plus
trademark/user-supplied flags. `evaluatePackPolicy(license)` decides whether a
pack is shippable, hosted-allowed, and publicly shareable;
`assertShippablePack` throws at bundle/publish boundaries. Policy: bundled or
public packs must be `open`, `public-domain`, `original`, or
`publisher-licensed`; `user-private` packs are never shipped; trademarked
setting material is shippable only when explicitly `publisher-licensed`.
Attribution is not a permission grant — the boolean flags decide.

## Campaign fork

`forkModuleIntoCampaign(db, pack)` copies the validated template into the
campaign DB's immutable `module_*` tables. It only reads the pack object, is
idempotent (an existing template is fully replaced), and records the license
into `module_meta` so share/host boundaries can enforce policy. Local forking
itself is not license-gated.

## world_query: template + overlay resolution

Module template rows are never mutated during play. Live divergence is written
as `overlay_facts` (E3) under keys built by
`worldOverlayKey(type, id, field)` (`world:<type>:<id>:<field>`).
`worldQuery(db, { type, id })` reads the immutable template, folds latest-wins
overlay fields over it, and returns `{ resolved, template, overlays }` so the
model narrates current truth — e.g. an NPC marked dead via an overlay fact
overrides the template disposition on every later query — while the original
template and the provenance of each divergence remain inspectable.

## Scope note

Schema, license metadata, fork, overlay resolution, and `world_query` ship now,
proven by the original sample pack `EMBERFALL_HOLLOW`
(`packages/core/src/world/samples/`). Converting a third-party adventure into
the schema is a separate content task gated on a confirmed legal source
(beads `eshyra-9s6`); no third-party adventure text is bundled.
