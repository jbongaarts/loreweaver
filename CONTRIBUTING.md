# Contributing

## External code contributions are not accepted yet

Eshyra's source-code license is intentionally deferred — **no source-code
license has been granted** and the packages are marked `private` / `UNLICENSED`.
See [docs/licensing.md](docs/licensing.md) for the full posture.

Because there is no inbound source-code license or contributor agreement in
place, **the project cannot accept external code contributions at this time.**
Pull requests that add or modify source code from outside contributors will not
be merged until a contribution licensing arrangement is defined. This hold is
tied to the open commercialization decision (`loreweaver-14h`) and distribution
decision (`loreweaver-bo2`); it will be revised once those are resolved.

You are welcome to read the code, open issues to report bugs, and discuss ideas.
Non-code feedback does not require a contribution license.

## Internal / agent workflow

Operational guidance for maintainers and AI agents working **inside** this
repository lives in [AGENTS.md](AGENTS.md) (`CLAUDE.md` simply imports it). In
summary:

- Issue tracking uses **bd (beads)**, not GitHub issues or markdown TODO lists.
  Run `bd ready` to find available work and `bd prime` for the full workflow.
- Dependency updates follow the conservative policy in
  [docs/dependencies.md](docs/dependencies.md), including special handling for
  the Node runtime and `better-sqlite3` compatibility.
- Bundled or publicly shared campaign/rules content must be open-licensed,
  public domain, original, or publisher-licensed; fair use is not the permission
  model.
