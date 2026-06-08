# Pull Request

<!-- BEGIN IMPORTER PR CHECKLIST -->
## Deterministic importer checklist

For PRs touching SRD importer, extractor, parser, audit, importer tests, or generated rules-pack records:

- [ ] I followed `docs/importer-fix-protocol.md`.
- [ ] I did not weaken regression tests or audit expectations to match current generated output.
- [ ] I identified affected generated record IDs before the fix.
- [ ] I added or confirmed audit/test coverage for the failure class.
- [ ] I regenerated generated records through the importer rather than hand-editing them.
- [ ] I verified committed generated output matches regenerated output.
- [ ] I reviewed and explained every generated record diff.
- [ ] I listed exact commands run and results.
- [ ] Any intentionally deferred importer issue is tracked in a follow-up bead.
<!-- END IMPORTER PR CHECKLIST -->
