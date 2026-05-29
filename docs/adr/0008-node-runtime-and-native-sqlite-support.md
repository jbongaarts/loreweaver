# ADR 0008: Node Runtime and Native SQLite Support

Status: accepted

Date: 2026-05-29

## Context

Loreweaver's local CLI is distributed through npm and depends on
`better-sqlite3` for the campaign SQLite store. `better-sqlite3` is the only
native dependency in the workspace, so the Node runtime support decision is also
a native binary support decision.

The workspace currently depends on `better-sqlite3` `^11.3.0`, resolved in the
lockfile as 11.10.0. The package installs through `prebuild-install` first and
falls back to `node-gyp` source compilation when a matching prebuilt binary is
not available. Source compilation is not an acceptable default for CI or the
first CLI release because it depends on local C++ toolchains and makes install
failures harder to diagnose.

The root package and both workspaces already declare:

```json
{ "engines": { "node": ">=22 <23" } }
```

That engine range causes npm to warn on Node 24 and communicates the supported
runtime boundary.

## Decision

Node 22 LTS remains the supported runtime for the first local CLI release.

Node 24 is intentionally outside the supported engine range while the workspace
uses `better-sqlite3` 11.x. A local Node 24 install may work when a compatible
native binding is already available or when the machine can compile the package
from source, but that is not a supported install path for users, CI, or release
automation.

CI and release jobs must keep `npm_config_build_from_source=false` when
installing dependencies. If the selected Node runtime does not have a matching
`better-sqlite3` prebuilt binary, the job should fail during install rather
than silently building with `node-gyp`.

Supporting Node 24 requires a separate dependency decision that, at minimum:

- upgrades `better-sqlite3` to a version with Node 24 prebuilt binaries for the
  supported CI/release platforms
- updates the root and workspace `engines.node` ranges
- proves clean installs with `npm_config_build_from_source=false`
- keeps lockfile churn limited to the intentional dependency change

## Consequences

- README prerequisites, package engine ranges, CI comments, release planning,
  and agent guidance all point to Node 22 LTS as the supported baseline.
- Node 24 local development remains possible but unsupported; successful local
  installs do not by themselves expand the support policy.
- No `better-sqlite3` upgrade is made as part of this decision.
- Future Node 24 work has a concrete acceptance bar instead of relying on
  incidental local install behavior.

## Rejected Alternatives

- **Declare Node 24 supported without changing `better-sqlite3`.** Rejected
  because support would depend on source compilation or incidental local native
  bindings rather than a reproducible prebuilt-binary install.
- **Upgrade `better-sqlite3` in this decision.** Rejected because this bead is
  about recording and aligning the runtime policy. A native dependency major
  upgrade should be reviewed and tested as its own focused change.
