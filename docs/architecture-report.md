# Eshyra Architecture And Roadmap Report

Status: current strategy synthesis, 2026-05-17

Eshyra is a text-first, persistent AI Dungeon Master for long-running fantasy campaigns. The product is not a generic fantasy chatbot and not a VTT-first application. The core value is a campaign engine that preserves canon across many play sessions, remembers prior events, tracks structured state, adjudicates rules through deterministic tools, and sustains a tabletop-like solo or small-group experience through text.

## Product Positioning

Eshyra serves two overlapping users:

- Tabletop-seeking solo adventurers who want D&D/TTRPG-style play when friends are unavailable, uninterested, hard to schedule, or nobody wants to DM.
- Living text-world nostalgists who loved text adventures, MUDs, BBS door games, and text RPGs but wanted worlds that could understand actions not preauthored by the designer.

The shared promise is open-ended text adventure plus tabletop rules and consequences plus persistent campaign memory. Eshyra should feel like a tabletop DM inhabiting a living text world, not a video game missing graphics.

## Interface Strategy

MVP and medium-term scope are text-first:

- Level 0: pure text narration, player input, dice/result display, state tracking, campaign memory, summaries, checkpoints, restore/fork, and theater-of-the-mind combat.
- Level 1: structured text UI panels for scene, party, active NPCs, locations, inventory, quests, clocks/fronts, conditions, recent rolls, memory/canon, and checkpoint history.
- Level 2: tactical abstractions such as zones, relative positioning, terrain tags, hazards, and engagement state.
- Level 3: compatibility or export for existing VTTs where useful.
- Level 4: native Eshyra VTT only after user demand proves it is necessary.

The DM engine must expose structured scene, combat, and campaign state so future VTT or map interfaces can be added without rewriting orchestration. Native VTT work is not early scope.

## Deployment Shape

Near-term development remains CLI/local-friendly. The CLI is the fastest route to core gameplay, power-user testing, local campaign state, and bring-your-own-key use without premature hosted infrastructure.

The likely public-facing medium-term product is a hosted, mobile-friendly web app or PWA. Native mobile is deferred until the core game loop and product experience are proven. A text-based DM works naturally in a responsive chat-style web interface, and a PWA avoids early app-store and platform maintenance costs.

## Model Architecture

Eshyra must not hardcode one model provider. The core should use provider adapters and model profiles. Initial development can use a Claude Agent SDK adapter, but the rest of the codebase should depend on local abstractions.

Likely provider adapters:

- Anthropic direct
- OpenAI direct
- AWS Bedrock
- Google Gemini
- OpenRouter
- local/open-model providers for experiments

Model profiles should describe capability needs rather than provider names:

- `premium_dm`
- `state_extractor`
- `summarizer`
- `rules_adjudicator`
- `memory_reconciler`
- `embedding_provider`
- `economy_or_experimental`

The same provider does not need to serve every profile.

## Premium Quality Floor

Eshyra is designed for premium frontier-model play. The intended primary DM experience assumes Opus 4.6+ / GPT-5.5-class quality or a future equivalent. The product targets a capability floor, not a price floor.

Economy models are not the default DM and should not power the primary public demo unless explicitly labeled experimental. Weaker models can fail on the exact differentiators Eshyra is trying to prove: continuity, canon preservation, recurring NPC consistency, long-context discipline, nuanced rulings, tool use, and memory reconciliation.

Cheaper models may be useful for bounded auxiliary tasks where they cannot directly corrupt canon: intent classification, retrieval routing, candidate extraction, draft summaries, simple validation, formatting, and non-authoritative helper analysis. Canon-changing operations require the premium model or validation before commit.

Custom, local, fine-tuned, or distilled models are not the primary DM strategy. The principle is trainable edges, frontier core. Eshyra should collect consent-aware structured traces so future helper-model training and evaluation are possible, but raw transcripts alone are not the valuable artifact. Useful traces include turn IDs, retrieved context, prompt profile, model output, tool calls, rules resolution, accepted and rejected state deltas, final narration, memory updates, human corrections, and quality flags.

## Billing And Demo Strategy

Medium-term default should be BYOK. Local BYOK keeps provider credentials on the user's machine and is best for CLI/local usage. Hosted BYOK can support web/PWA usage but needs careful secret handling: encrypted storage or per-session entry, and stored provider keys must never be exposed back to the browser.

Hosted credits remain a future convenience option, not an early blocker. They introduce inference cost risk, billing, abuse controls, quotas, pricing, and provider availability concerns.

Public demos should use a premium DM model, a short bounded turn limit, and a preloaded campaign/module state. The demo should show continuity, memory, and structured campaign-state behavior. A few excellent turns are better than many mediocre turns.

## Cost Control And Evaluation

Eshyra must not send entire campaign history every turn. Cost control comes from orchestration:

- retrieve only relevant campaign memory
- keep active scene context compact
- use summaries and checkpoints
- separate stable campaign context from dynamic turn context
- use prompt caching or provider equivalents where available
- use cheaper auxiliary models only where safe

Metrics should include cost per high-quality turn, cost per resolved scene, cost per session, cost per checkpoint summary, latency per turn, quality by model/profile, memory/canon error rate, and tool-use reliability.

An evaluation harness should test whether a model meets the `premium_dm` quality floor. Scenarios should include delayed NPC returns, faction deception consequences, cursed item symptoms, uncertain/conflicting rumors, terrain and hidden information in combat, rules adjudication mid-scene, checkpoint restore/fork branches, prior choices constraining narration, unanticipated player actions, and intent inference.

## Rules, Campaign Content, And Licensing

Eshyra keeps rules/mechanics knowledge, campaign/module content, live campaign/session state, user-private content, and generated campaign memory separate. This supports different rules systems, original campaign packs, user-private packs, publisher-licensed packs, attribution, provenance, and safer hosting policy.

Public or bundled packs must be open-licensed, public domain, original, or publisher-licensed. Public/shared pack libraries follow the same rule. Hosted token usage is limited to allowed/open/original/licensed material unless a later private-use policy explicitly permits more.

User-private packs are supported through a pack spec and tooling, require users to affirm rights to use uploaded/source material, are not published or redistributed, and are BYOK-preferred. The product should not ship closed-IP derived packs merely gated by user ownership confirmation. Attribution is necessary when required by license, but attribution alone is not a permission model.

Pack metadata should include license and allowed-use policy fields:

- `packId`, `title`, `packType`
- `licenseClass`, `licenseName`, `attributionText`, `requiresAttribution`
- `commercialUseAllowed`, `hostedUseAllowed`, `redistributionAllowed`, `publicSharingAllowed`, `derivativeAllowed`
- `containsUserSuppliedText`, `containsTrademarkedSettingMaterial`
- `sourceMaterialDescription`, `provenancePolicy`, `outputRestrictions`

## Non-Goals

- Do not build native mobile first.
- Do not make a native VTT part of early scope.
- Do not make a cheap/economy model the default public demo.
- Do not hardcode Claude as the only possible provider.
- Do not depend exclusively on AWS Bedrock.
- Do not require hosted billing before the product is useful.
- Do not treat low-cost model compatibility as equivalent to intended product quality.
- Do not plan on a custom/local model replacing the premium DM.
- Do not base public/hosted content strategy on fair use.
- Do not ship closed-IP derived packs merely gated by user ownership confirmation.
- Do not mix rules mechanics, campaign content, and live campaign memory into one opaque knowledge base.

## Roadmap Mapping

Existing beads epics remain the implementation structure:

- E0 owns the provider/profile abstraction seam, initial Claude Agent SDK adapter, and CLI/local configuration.
- E1 owns structured open-licensed rules data and attribution for SRD-derived material.
- E2 owns pack schema, license metadata, immutable campaign templates, user-private pack posture, and `world_query`.
- E3 owns canonical live state and provenance-backed canon writes. See `docs/game-state.md` for the canonical schema and tool contract.
- E4 owns campaign memory, roll-ups, structured trace capture, and future training/eval data.
- E5 owns turn orchestration, bounded context assembly, tool discipline, prompt caching opportunities, cost metrics, and model evaluation harness hooks.
- E6 owns local CLI session lifecycle, checkpoint-facing UX, and medium-term web/PWA handoff boundaries.
- E7 owns SRD-compliant character creation and future importer mapping into the canonical schema.
- E8 owns checkpoint/history/branching through Dolt, off the per-turn path.

## Assumptions And Risks

- The initial implementation can use Claude Agent SDK while preserving a provider-neutral core boundary.
- The first adventure/module must be confirmed open, public-domain, original, or licensed before conversion.
- Hosted BYOK requires a separate secret-handling design before any public web launch.
- Provider prompt-caching behavior and structured-output reliability differ enough that profile capability tests are required.
- Premium frontier inference may be expensive until the target quality class becomes cheaper; demos should constrain turns rather than lower quality.
