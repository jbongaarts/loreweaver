# CLI Distribution Plan

This is the initial post-MVP distribution plan for the local Loreweaver CLI.
It covers the pre-1.0 CLI release path; hosted web/PWA distribution remains
governed by ADR 0002.

## Decision

Ship the local CLI as two npm packages:

- `@loreweaver/core`
- `@loreweaver/cli`

The initial release channel is the npm registry, with a matching GitHub Release
for changelog, tag provenance, and attached `npm pack` tarballs. The supported
user install command is:

```bash
npm install -g @loreweaver/cli
```

No separate curl/bash one-command installer is required for the first release.
npm is the installer, Node is the runtime boundary, and Dolt remains optional
and consent-installed through the CLI.

## Package Shape

`@loreweaver/core` is the reusable engine package. Publish only:

- `dist/**`
- `package.json`
- README/license files needed by the registry

`@loreweaver/cli` is the executable package. Publish only:

- `dist/**`
- `package.json`
- README/license files needed by the registry

The CLI package depends on the matching `@loreweaver/core` version. Releases
must publish both packages from the same git tag and version. The root workspace
stays private; only the package workspaces are published.

Before the first publish, package metadata should be tightened:

- add `files` allowlists so source, tests, and local campaign files are not
  published accidentally
- confirm the CLI `bin` entrypoint has an executable shebang and works after
  global install
- add final `license`, `repository`, and npm provenance metadata
- decide whether the first public version is `0.1.0` or another pre-1.0 semver

## Build And Release Commands

Release builds run from a clean checkout on Node 22 LTS:

```bash
npm ci
npm run clean
npm run typecheck
npm run test
npm pack --workspace @loreweaver/core --pack-destination dist-release
npm pack --workspace @loreweaver/cli --pack-destination dist-release
npm publish --workspace @loreweaver/core --provenance
npm publish --workspace @loreweaver/cli --provenance
```

Use `npm run typecheck` rather than plain `npm run build` as the release gate
because it forces TypeScript project references and avoids stale incremental
build output. `npm run clean` should run before packaging so `dist/**` is
created by the release job, not inherited from a developer machine.

Initial automation can be manual plus CI-verified:

1. Update package versions and changelog/release notes.
2. Open a PR; CI must pass.
3. Merge to `main`.
4. Create a signed release tag.
5. Run a GitHub Actions release workflow that performs `npm ci`,
   `npm run clean`, `npm run typecheck`, `npm run test`, `npm pack`, and
   `npm publish --provenance`.
6. Attach the generated tarballs and smoke-test transcript to the GitHub
   Release.

## Runtime Policy

Node 22 LTS is the supported runtime for the first CLI release. It is the same
runtime CI uses and has a prebuilt `better-sqlite3` binary for the pinned 11.x
line.

Node 24 is not the first-release support target while `better-sqlite3` remains
on 11.x. Local Node 24 can work when a native binding is available or the user
has a C++ toolchain, but a distributed CLI should not depend on source
compilation during install. Moving the support target to Node 24 requires
upgrading to a `better-sqlite3` version with Node 24 prebuilds and proving a
clean install with `npm_config_build_from_source=false`.

The release workflow must keep:

```bash
npm_config_build_from_source=false
```

for CI and release packaging. A missing native prebuild should fail loudly
rather than silently compiling with `node-gyp`.

## Dolt Story

Dolt is not bundled into the npm packages. The CLI works without Dolt; graceful
session close still writes the recap and reports that no checkpoint was made.

For checkpoints, users can either:

- install Dolt themselves so `dolt` is on `PATH`
- set `LOREWEAVER_DOLT_BIN` to an explicit binary path
- run `loreweaver dolt install` to install a verified binary into the managed
  cache

`LOREWEAVER_DOLT_HOME` controls the managed cache root and defaults to
`~/.loreweaver/dolt`. Managed install requires interactive consent; CI and
non-interactive shells decline automatically.

Campaign checkpoints live in `<LOREWEAVER_DB_PATH>.checkpoints`; see
[Local Storage](storage.md) for the storage boundary and beads separation
rules.

## Fresh Install Smoke Test

Run this on a machine or container with no repository checkout and Node 22 LTS:

```bash
node --version
npm --version
npm install -g @loreweaver/cli@<version>
loreweaver
```

Expected: the banner prints the core version. Without configuration, it should
exit with a config error naming `LOREWEAVER_DB_PATH`.

Then smoke the configured CLI:

```bash
mkdir loreweaver-smoke
cd loreweaver-smoke
export LOREWEAVER_DB_PATH="$PWD/dev.db"
export ANTHROPIC_API_KEY="<test key or live smoke key>"
loreweaver
```

Expected: the banner prints the resolved database path and model.

Optional Dolt smoke:

```bash
loreweaver dolt install
```

Expected: in an interactive shell, the command asks for consent before
installing; in a non-interactive shell, it declines automatically.

Live play smoke:

```bash
loreweaver play
```

Expected: a new campaign is created from `EMBERFALL_HOLLOW`, one player input
can complete a model-backed turn, and `/quit` closes the session. If Dolt is
available, the close reports a checkpoint id and creates
`$LOREWEAVER_DB_PATH.checkpoints`; otherwise it closes without a checkpoint.

## Release Blockers Before First Publish

The plan is intentionally compatible with the current workspace shape, but the
first publish should not happen until these are resolved or explicitly waived:

- executable global install behavior is verified after packaging
- package `files`, license, repository, and provenance metadata are finalized
- default user data directory decision is made or the required
  `LOREWEAVER_DB_PATH` MVP behavior is explicitly kept for the first release
- package smoke tests are added to CI or release automation so a missing `dist`
  file, bad `bin`, or missing native prebuild fails before publish
