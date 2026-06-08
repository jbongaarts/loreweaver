# Importer Agent Instructions

This directory contains deterministic rules-pack importers. Importer fixes are regression-sensitive and must follow the repository importer protocol.

Read and follow:

- `docs/importer-fix-protocol.md`

Mandatory local rules:

1. Treat regression tests and audit expectations as contracts.
2. Do not weaken tests to match current generated output.
3. Identify affected generated record IDs before changing parser behavior.
4. Add or confirm audit/test coverage for the failure class before parser changes.
5. Do not hand-edit generated rules-pack records.
6. Regenerate records through the importer and verify committed output matches regenerated output.
7. Explain every generated record diff in the PR summary.
8. If scope is intentionally deferred, create or update a follow-up bead with concrete examples and expected behavior.
