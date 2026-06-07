# Licensing Posture

This document records Eshyra's **current** licensing posture. It is
intentionally a statement of a *deferred* decision, not a final license. It will
be revised once the open business decisions below are made.

## Source-Code License: Not Yet Granted

**No source-code license has been granted for this repository.**

The Eshyra source code is published for visibility only. Absent an explicit
license, default copyright applies and **no rights to use, copy, modify, or
redistribute the source code are granted** to third parties. Viewing the
repository does not convey any such rights.

This is a deliberate hold, not an oversight. The repository owner has not yet
decided the commercialization model (see
[Open Decisions](#open-decisions-tracked-in-beads)), and choosing a source-code
license prematurely would foreclose options that decision must remain free to
take. Until that decision is recorded:

- The root workspace and both npm workspaces (`@eshyra/core`,
  `@eshyra/cli`) are marked `private: true`.
- Their `package.json` `license` metadata is set to `UNLICENSED`, the npm
  convention for a package that carries **no** grant of source-code rights and
  is not licensed for redistribution.
- None of the packages are intended for npm publication in this state.

## Source-Code Rights Are Separate From Content Licenses

The source-code posture above governs only the **engine, CLI, and supporting
code** in this repository. It is independent of the licenses that apply to
bundled or referenced **content**:

- **Rules packs** (e.g. the bundled D&D 5e SRD and Pathfinder 2e Remaster
  fixtures) carry their own upstream content licenses. Bundled or publicly
  shared rules content must be open-licensed, public domain, original, or
  publisher-licensed, with license and provenance recorded in each pack's
  metadata. Fair use is not the permission model.
- **Adventures / modules** are governed by their own source legality. This
  repository must not bundle or publish third-party adventure text until that
  source is confirmed open, public domain, original, or publisher-licensed.
  That review is tracked separately by bead `eshyra-9s6`.

In short: a future grant of source-code rights would **not** automatically grant
rights to bundled content, and the content licenses already in effect do **not**
imply any source-code license.

## Release / Distribution

**npm publication is deferred pending a business/licensing decision.** The CLI
distribution mechanics are planned in [cli-distribution.md](cli-distribution.md),
but no package will be published while the source-code license is unresolved and
the packages remain `private` / `UNLICENSED`. The release blockers in that plan
include finalizing the source-code license and removing the `private` guards;
neither will happen before the decisions below are recorded.

## Contributions

**External code contributions are not accepted yet.** Until a contribution
licensing arrangement (e.g. an inbound license or contributor agreement) is
defined, the project cannot accept outside source-code contributions, because
there is no source-code license under which contributed code could be received
and redistributed. See [CONTRIBUTING.md](../CONTRIBUTING.md).

## Open Decisions (tracked in beads)

The deferred posture above is resolved by two follow-up decisions:

- **Distribution channel** — npm vs binary release vs hosted-first
  (`eshyra-bo2`).
- **Commercialization model** — open source, open core, source-available,
  proprietary, or hosted-first (`eshyra-14h`).

Once those are decided, this document, the package `license` metadata, the
`private` guards, and the contribution policy will be updated to match, and a
repository-level `LICENSE` file will be added if the chosen model calls for one.
