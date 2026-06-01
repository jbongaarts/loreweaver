# Vendored Source: D&D 5e SRD 5.1

This directory is the vendored-source location for the D&D 5e System Reference
Document 5.1 importer (`packages/core/scripts/importers/dnd5e-srd-5.1/`). Per
ADR 0007, authoritative rules-pack content is produced by deterministic code
running over a vendored licensed source artifact -- not generated from model
knowledge -- so the artifact lives in-repo, pinned by SHA-256.

The pinned metadata for this artifact lives in
[`manifest.json`](./manifest.json); this README is the human-readable
counterpart. If the two disagree, `manifest.json` is the source of truth.

## Pinned artifact

| Field                | Value                                                                                                |
|----------------------|------------------------------------------------------------------------------------------------------|
| Filename             | `SRD_CC_v5.1.pdf`                                                                                    |
| Source title         | System Reference Document 5.1                                                                        |
| Source version       | 5.1                                                                                                  |
| Publisher            | Wizards of the Coast LLC                                                                             |
| Source URL           | `https://media.dndbeyond.com/compendium-images/srd/5.1/SRD_CC_v5.1.pdf`                              |
| Licensed-released    | 2023-01-27 (Wizards' CC-BY-4.0 release announcement; underlying rules text predates this date)       |
| Retrieved            | 2026-06-01                                                                                           |
| License              | Creative Commons Attribution 4.0 International (CC-BY-4.0)                                           |
| License URL          | `https://creativecommons.org/licenses/by/4.0/legalcode`                                              |
| Size (bytes)         | 3,158,713                                                                                            |
| SHA-256              | `2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0`                                   |

Wizards' canonical landing page for the SRD distribution is
`https://dnd.wizards.com/resources/systems-reference-document`; that page links
to whichever mirror Wizards currently serves the PDF from (the
`media.dndbeyond.com` URL above is the form in use as of the retrieved date).

## Why the PDF is committed

The PDF is licensed under CC-BY-4.0, which permits redistribution. Committing
it in-repo:

- Makes a single SHA-256 pin authoritative for every clone and every CI job.
- Lets the `loreweaver-0m9.5` importer, the `loreweaver-0m9.10` rules-pack
  audit tooling, and any future SRD coverage validation (e.g. exact creature
  name-set check tracked in `loreweaver-0m9.5.14`) run against the same bytes
  the SHA-256 in this README and in generated `manifest.json` blocks describe.
- Removes the previous "contributors download locally" step, so a contributor
  cannot accidentally point the importer at a silently swapped or wrong-version
  PDF.

ADR 0007 rejected fetch-at-build-time vendoring on reproducibility grounds; the
README that previously lived here also noted committing was being deferred
until the audit tooling in `loreweaver-0m9.10` existed. That tooling has now
landed (commit `c518f5c`), so the PDF is committed as a single one-shot
addition rather than via Git LFS or an out-of-band fetch script.

## Verifying the pinned hash

The SHA-256 above is the only authoritative fingerprint. To verify a local
checkout matches:

```bash
# from the repo root
sha256sum packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf
```

(On Windows PowerShell: `Get-FileHash -Algorithm SHA256 packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf`.)

The importer (`runImporter`) computes the same hash on every run and writes it
into the generated pack's `manifest.json` under `source.sourceHash`, so any
mismatch between a regenerated pack and the pinned source is detectable
post-hoc as well.

## Attribution

The SRD 5.1 PDF's first-page **Legal Information** section requires the
following verbatim attribution statement on any redistribution of material
taken from the SRD. Do not paraphrase, shorten, or reword it -- the wording
below is quoted from the PDF preamble itself and is also pinned in
`manifest.json` under `attribution.text` (the source of truth for tooling):

> This work includes material taken from the System Reference Document 5.1
> ("SRD 5.1") by Wizards of the Coast LLC and available at
> `https://dnd.wizards.com/resources/systems-reference-document`. The SRD 5.1
> is licensed under the Creative Commons Attribution 4.0 International License
> available at `https://creativecommons.org/licenses/by/4.0/legalcode`.

The same preamble also instructs: "Please do not include any other attribution
regarding Wizards other than that provided above. You may, however, include a
statement on your work that it is 'compatible with fifth edition' or '5E
compatible.'" The generated rules-pack license block at
`packages/core/data/rules-packs/rules__dnd5e-srd-5.1/manifest.json` is the
authoritative copy carried with redistributed records; `loreweaver-bnb` tracks
aligning that pack's `attributionText` with the verbatim preamble quoted here.

## Updating the vendored artifact

This artifact is intended to be stable -- the SRD 5.1 corpus is a fixed
released document. If Wizards republishes the SRD 5.1 PDF (e.g. a typo
correction) and we want to track the new bytes:

1. Replace `SRD_CC_v5.1.pdf` in this directory.
2. Update `sha256`, `sizeBytes`, and `retrievedAt` in `manifest.json` (and the
   corresponding rows in this README).
3. Re-run the importer (`npm run import:dnd5e-srd`) and verify the generated
   pack still validates and any coverage tests still pass.
4. Commit the PDF + manifest + regenerated pack as one change.

SRD 5.2 lives in its own sibling directory once introduced; do not commingle
versions in this one.
