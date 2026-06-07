# ADR 0002: Hosted Web/PWA BYOK Deployment Path

Status: accepted

Date: 2026-05-20

## Context

ADR 0001 set Eshyra as a text-first, premium-model campaign engine whose
MVP is CLI/local-friendly, with a hosted mobile-friendly web app or PWA as the
likely medium-term public experience and native mobile deferred. It also set
billing as BYOK-first with hosted credits as a future option.

ADR 0001 recorded those positions but did not describe *how* the deployment
path is staged or — critically — how player-supplied provider API keys are
handled once the product is hosted. E6 builds the player-facing session
wrapper and a thin CLI; before that boundary hardens we need a decision record
for the deployment shape and, especially, for hosted BYOK secret handling, so
later front-end work cannot quietly leak provider keys or assume a billing
model that was never agreed.

"BYOK" (bring your own key) means the player supplies their own model-provider
API key and pays the provider directly; Eshyra never resells model access
in this mode.

## Decision

Eshyra ships along one deployment path with three stages over the same
UI-agnostic TypeScript core. The core never changes between stages; only the
front-end and the key-handling surface do.

### Stage 1 — CLI / local (MVP, current)

The CLI is a thin presentation layer over the core: campaign select/create,
prompt I/O, and the resume prompt, with no game-rule logic (E6 acceptance #5).
DM narration is written to the player when each turn completes — turn-granular
output, not token-level streaming. The `ModelClient.complete` contract returns
a whole completion (`Promise<string>`), and the CLI prints `result.narration`
once `runTurn` resolves. Token-level streaming through the model/client/CLI
path is deliberately out of Stage 1 scope; it would require a streaming variant
of `ModelClient` and a partial-output channel through `runTurn`, neither of
which an MVP CLI needs. If a future stage wants live token output, it lands as
an additive `ModelClient` capability behind its own decision record. Campaign
state is a local SQLite database; Dolt checkpoints are local. This is the
development surface and the power-user/local surface, and it remains supported
after later stages ship — it is not replaced.

**Local BYOK.** The provider key is read from the local environment or a local
config file owned by the user (e.g. `ESHYRA_PROFILE_*` / provider env
vars). The key never leaves the user's machine, is never transmitted to a
Eshyra-operated service, and is never written into the campaign DB, Dolt
history, or `turn_trace`. The user owns the key's lifecycle entirely.

### Stage 2 — Hosted web / PWA

The public medium-term experience is a hosted, mobile-friendly responsive web
app delivered as an installable PWA (offline-capable shell, home-screen
install, push-free). It runs the *same* core behind a thin server: the browser
is a presentation client only — campaign state, orchestration, tools, and
canon writes stay server-side. The PWA gives a near-app mobile experience
without a native build.

**Hosted BYOK is the default hosted billing shape.** The player supplies their
own provider key; Eshyra hosts the engine and storage but does not resell
model tokens. This keeps Stage 2 free of a billing/payments dependency and
matches ADR 0001's BYOK-first position.

### Stage 3 — Hosted credits (future, optional, not an MVP blocker)

A future option where Eshyra provisions model access and meters usage as
credits, for players who do not want to manage a provider key. This requires a
separate decision record covering payments, metering, abuse limits, and cost
exposure. It is explicitly **not** an MVP blocker and nothing in Stages 1–2 may
assume it exists.

### Hosted BYOK secret handling (load-bearing)

When a player stores a provider key in the hosted product, the following rules
are mandatory and load-bearing:

1. **Write-only from the browser.** The key is accepted over TLS by the server
   and stored encrypted at rest (envelope encryption; the data-encryption key
   is held by a managed KMS, never in the application DB). The plaintext key
   exists in process memory only for the duration of a model call.
2. **Never exposed back to the browser after storage.** Once stored, the key is
   never returned in any API response, page render, log, or error message. The
   UI may show only non-secret metadata — provider, a masked suffix (e.g.
   `…a1b2`), and a stored-at timestamp. A player who wants to change the key
   replaces it with a new write; there is no "reveal" path. This is the single
   most important invariant of this ADR.
3. **Server-side use only.** Model calls execute server-side; the decrypted key
   is never shipped to client JavaScript. The browser never holds a usable
   provider key in the hosted product.
4. **Excluded from campaign data.** Keys are stored in a separate secret store,
   not in the campaign SQLite DB, Dolt checkpoints/history, `turn_trace`,
   memory tables, or exports. Checkpoint/branch/share operations can never
   carry a key.
5. **Player-controlled lifecycle.** The player can delete the stored key; delete
   removes ciphertext and revokes server access. Keys should be treated as
   rotatable and never logged in plaintext anywhere.

These rules are testable assertions for Stage 2 front-end and server work, not
aspirations.

### Native mobile is deferred

Native iOS/Android apps are explicitly deferred. The PWA is the mobile answer
for the foreseeable scope. Reintroducing native mobile requires a new decision
record. (Native VTT and custom/local primary-DM replacement remain non-goals
per ADR 0001.)

## Consequences

- E6's CLI stays a thin presentation layer with no game logic, so the same core
  seam serves the Stage 2 server unchanged.
- A hosted server seam must keep campaign state, orchestration, and canon writes
  server-side; the browser is never trusted with game logic or secrets.
- Stage 2 requires a secret store (KMS-backed envelope encryption) that is
  separate from campaign storage; this is new infrastructure, not a core
  change.
- API responses, server logs, and error payloads must be audited so a stored
  provider key can never appear in them; the "no reveal after storage" rule
  needs an explicit test.
- BYOK (local and hosted) carries no payments dependency, so Stages 1–2 ship
  without a billing system.
- Hosted credits remain deferred and gated on a separate ADR; no Stage 1–2 code
  may depend on it.
- Native mobile work is out of scope absent a new ADR.

## Rejected Alternatives

- **Native-mobile-first deployment:** rejected (consistent with ADR 0001) — a
  responsive PWA better matches the text-first experience without a native
  build and store-review cost.
- **Browser-side key use:** rejected — shipping the provider key to client
  JavaScript exposes it to XSS, extensions, and shared devices; hosted BYOK
  must keep the key server-side.
- **Reveal/return the stored key in the UI:** rejected — any read-back path is
  an exfiltration path; replace-only with masked metadata is the only safe
  shape.
- **Storing keys in the campaign DB or Dolt history:** rejected — keys would
  then flow through checkpoints, branches, exports, and `turn_trace`; secrets
  must live in a separate KMS-backed store.
- **Hosted credits as the MVP billing model:** rejected for early scope — it
  pulls in payments, metering, and cost-exposure design that BYOK avoids; it
  remains a future option behind its own ADR.
- **Replacing the CLI once the web app ships:** rejected — the CLI is the
  development and local/power-user surface and stays supported alongside the
  hosted product.
