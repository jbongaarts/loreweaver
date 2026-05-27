# Vendored Source: D&D 5e SRD 5.1

This directory is the vendored-source location for the D&D 5e System Reference
Document 5.1 importer (`packages/core/scripts/importers/dnd5e-srd-5.1/`). Per
ADR 0007, authoritative rules-pack content is produced by deterministic code
running over a vendored licensed source artifact — not generated from model
knowledge — so the artifact must live here before the importer can be run.

## Expected file

- **Filename:** `SRD_CC_v5.1.pdf`
- **License:** Creative Commons Attribution 4.0 International (CC-BY-4.0)
- **Publisher:** Wizards of the Coast LLC
- **Source URL:** Wizards' canonical distribution of the SRD 5.1 PDF. The PDF
  has been redistributed by Wizards from a few URLs over time; download from
  whichever distribution Wizards currently links to from
  `https://dnd.wizards.com/resources/systems-reference-document`.
- **Expected SHA-256:** _(populated on first importer run — see "Pinning the
  source hash" below.)_

## Why the PDF is not committed

The PDF is licensed under CC-BY-4.0, which allows redistribution. Loreweaver
does not commit binary artifacts of this size to the source branch as a matter
of repository hygiene — they bloat clone size and are not diffable. Contributors
download the artifact and place it here; the importer pins its SHA-256 into the
generated pack manifest so divergence is detectable.

A future change may switch to committing the PDF (single commit, no rewrites)
or vendoring a normalized intermediate; that decision can be made when the
audit tooling in `loreweaver-0m9.10` is in place.

## Pinning the source hash

On the first successful importer run against a placed PDF, the CLI prints the
computed SHA-256. That value should be recorded in this README as the
**Expected SHA-256** above so subsequent runs (and CI) can verify the artifact
hasn't been silently swapped. The generated `manifest.json` always carries the
current run's hash in `source.sourceHash` regardless.

## Attribution

Any redistribution of records extracted from this PDF must carry the SRD 5.1
attribution text:

> This work includes material from the System Reference Document 5.1 by
> Wizards of the Coast LLC, available under CC-BY-4.0.

The generated pack license block carries this text per record; see
`packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json`.
