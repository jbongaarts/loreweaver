# ADR 0001: Text-First Premium-Model Campaign Engine

Status: accepted

Date: 2026-05-17

## Context

Eshyra is intended to be a persistent AI Dungeon Master for long-running text-based tabletop fantasy campaigns. The project already has epics for foundation, SRD lookup, world modules, game state, memory, orchestration, session lifecycle, character creation, and Dolt checkpointing. Recent product strategy decisions need to be reflected in the architecture and issue plan.

## Decision

Eshyra will be built as a text-first long-campaign AI DM engine.

The MVP remains CLI/local-friendly for development, power users, local campaign state, and BYOK usage. The likely public-facing medium-term experience is a hosted, mobile-friendly web app or PWA. Native mobile and native VTT work are deferred.

Model integration will use provider adapters and model profiles. Initial Claude Agent SDK usage is an adapter choice, not a core dependency. The primary `premium_dm` profile targets Opus 4.6+ / GPT-5.5-class quality or a future equivalent. Economy models are allowed only for experiments or bounded auxiliary tasks unless explicitly validated for the profile they are serving.

Eshyra targets a capability floor, not a price floor. The strategic bet is that today's premium-enough model class becomes more affordable as newer frontier generations appear.

Billing starts BYOK-first. Hosted credits are a future option, not an early architecture blocker.

Rules/mechanics, campaign/module content, live campaign state, user-private content, and generated campaign memory remain separated. Public or bundled content must be open-licensed, public domain, original, or publisher-licensed. User-private packs are supported through pack metadata and policy controls, preferably with BYOK. Public/hosted strategy must not depend on fair use or ownership-gated closed-IP derived packs.

## Consequences

- E0 must preserve a provider-neutral core seam and model profile configuration instead of spreading Claude-specific assumptions.
- E2 must include license, attribution, provenance, and allowed-use metadata in pack schema.
- E4/E5 must support compact context assembly, memory provenance, structured trace capture, cost metrics, and model evaluation.
- E6 stays focused on CLI/local while keeping front-end boundaries compatible with a future web/PWA.
- Demos should be short and premium-model-backed rather than economy-model-backed.
- Native VTT, native mobile, hosted billing, and custom/local DM replacement models are explicit non-goals for early scope.

## Rejected Alternatives

- VTT-first product scope: rejected because the differentiator is persistent campaign intelligence, not maps/tokens/lighting.
- Native-mobile-first deployment: rejected because responsive web/PWA better matches the early text-first experience.
- Economy-model-first public demo: rejected because it risks misrepresenting the product's intended quality.
- Single-provider architecture: rejected because provider quality, cost, capabilities, and availability will change.
- Custom/local model as primary DM: rejected because the primary quality requirement is frontier-level general reasoning, narration, long-context discipline, and tool use.
- Fair-use-dependent public content strategy: rejected as an unsuitable load-bearing permission model.
