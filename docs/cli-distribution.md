# CLI Distribution Plan

This is the initial post-MVP distribution plan for the local Loreweaver CLI.
It covers the pre-1.0 CLI release path; hosted web/PWA distribution remains
governed by ADR 0002.
Local storage uses the managed per-user data root and campaign registry; see
[ADR 0004](adr/0004-config-file-and-campaign-registry.md) and
[Local Storage](storage.md).

> **Publication is deferred.** This plan describes the *mechanics* of an npm
> release, but **npm publication is on hold pending a business/licensing
> decision.** No package will be published while the source-code license is
> unresolved and the workspaces remain `private` / `UNLICENSED`. See
> [licensing.md](licensing.md). The distribution channel itself (npm vs binary
> release vs hosted-first) is an open decision tracked by `loreweaver-bo2`, and
> the commercialization model by `loreweaver-14h`; either could change the plan
> below.

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

Before the first publish, package metadata should be tightened. These steps are
**blocked** until the deferred source-code license and commercialization
decisions are made (see [licensing.md](licensing.md), `loreweaver-14h`,
`loreweaver-bo2`):

- finalize the repository source-code license and replace the `UNLICENSED`
  package `license` metadata with the chosen license
- remove the temporary `private: true` package guards from publishable
  workspaces only after the source license is finalized
- verify `repository` metadata and npm provenance settings
- decide whether the first public version is `0.1.0` or another pre-1.0 semver

## Build And Release Commands

Release builds run from a clean checkout on Node 24 LTS:

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
6. Run the fresh-install smoke test against the packed artifacts.
7. Attach the generated tarballs and smoke-test transcript to the GitHub
   Release.

## Runtime Policy

Node 24 LTS is the supported runtime for the first CLI release. This follows
[ADR 0008](adr/0008-node-runtime-and-native-sqlite-support.md). It is the same
runtime CI uses and has a prebuilt `better-sqlite3` binary for the pinned 12.x
line.

The package engines intentionally target `>=24 <25`. Moving the support target
again requires updating the package engines, the CI Node version, and the
`better-sqlite3` version together, then proving a clean install with
`npm_config_build_from_source=false`.

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
`<data-root>/dolt`. Managed install requires interactive consent; CI and
non-interactive shells decline automatically.

Campaign checkpoints live beside the selected SQLite database as
`<dbPath>.checkpoints`; see [Local Storage](storage.md) for the storage
boundary and beads separation rules.

## Fresh Install Smoke Test

CI covers the package-content part of this path by running `npm pack
--dry-run --json` for both packages after build. That test must keep proving
the tarballs include `dist/**` and exclude source/test files.

Release automation also runs the clean-prefix install smoke:

```bash
npm run smoke:cli-install
```

That script performs a clean TypeScript build, packs both workspaces, installs
the local tarballs into a temporary global npm prefix, invokes the installed
`loreweaver` command, and verifies the expected first-run config guidance.

Run this on a machine or container with no repository checkout and Node 24 LTS:

```bash
node --version
npm --version
npm install -g @loreweaver/cli@<version>
loreweaver
```

Expected: the banner prints the core version and the resolved data root.
Without provider credentials it exits with a config error naming
`ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`.

Then smoke the configured CLI:

```bash
mkdir loreweaver-smoke
cd loreweaver-smoke
export LOREWEAVER_HOME="$PWD/.loreweaver"
export ANTHROPIC_API_KEY="<real test key or live smoke key>"
loreweaver
loreweaver new "Smoke Campaign"
loreweaver campaigns list
```

Expected: with a real provider credential, the banner prints the resolved data
root and model, `new` creates a managed database under
`$LOREWEAVER_HOME/campaigns/`, and `campaigns list` shows the registered
campaign. An empty `ANTHROPIC_API_KEY` is treated as unset; use
`CLAUDE_CODE_OAUTH_TOKEN` instead when smoking subscription-token auth.

Optional explicit-path smoke:

```bash
export LOREWEAVER_DB_PATH="$PWD/dev.db"
loreweaver
```

Expected: the banner also prints the explicit database path. This bypasses the
managed registry and is intended for scripted, CI, and power-user workflows.

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

Expected: the registered managed campaign opens, one player input can complete
a model-backed turn, and `/quit` closes the session. If Dolt is available, the
close reports a checkpoint id and creates `<dbPath>.checkpoints` beside the
campaign database; otherwise it closes without a checkpoint.

## Release Blockers Before First Publish

The plan is intentionally compatible with the current workspace shape, but the
first publish should not happen until these are resolved or explicitly waived:

- the deferred business decisions are made: distribution channel
  (`loreweaver-bo2`) and commercialization model (`loreweaver-14h`)
- final source-code license, repository, and provenance metadata are added, the
  `UNLICENSED` placeholder is replaced, and publishable workspaces are no longer
  marked `private`
- release automation installs the packed tarballs and invokes the global
  `loreweaver` command in a clean prefix before publish
