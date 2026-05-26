/**
 * Premium bounded demo campaign mode (E6).
 *
 * The public demo is a *bounded*, not a *cheapened*, experience: it runs the
 * real `premium_dm` profile so prospective players see intended quality, but
 * caps the number of turns and loads only content that is legal to host and
 * share publicly. Quality is bounded by a turn budget, never by silently
 * swapping in an economy model — if a non-premium profile is ever used, the
 * run is explicitly labelled experimental so its output is not mistaken for
 * the intended DM quality.
 *
 * This module wires together existing subsystems (module fork, session
 * lifecycle, license policy, model profiles) into one demo entry point; it
 * holds no game-rule logic of its own. Continuity, live state, and checkpoints
 * are demonstrated by the standard scene/session/checkpoint machinery — a demo
 * campaign is an ordinary campaign with a cap and a content allow-list.
 */

import { createCampaign } from './campaign.js';
import {
  DEFAULT_PROFILE_REGISTRY,
  type ModelProfileName,
  type ProfileRegistry,
  type ProfileTier,
  type ProviderId,
  getProfile,
} from './model/profiles.js';
import type { Db } from './persistence/db.js';
import { type SessionRecord, startSession } from './session.js';
import { evaluatePackPolicy } from './world/license.js';
import { EMBERFALL_HOLLOW } from './world/samples/emberfallHollow.js';
import type { ModulePack } from './world/types.js';

/** Default turn cap for the bounded public demo. */
export const DEMO_TURN_CAP = 25;

/**
 * The module bundled as the default demo adventure. It is wholly original
 * CC-BY-4.0 content (see {@link EMBERFALL_HOLLOW}), so it is safe to host and
 * share in a public demo without a publisher licence.
 */
export const DEFAULT_DEMO_PACK: ModulePack = EMBERFALL_HOLLOW;

export class DemoModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoModeError';
  }
}

/**
 * Whether a demo run reflects the intended DM quality. `experimental` is used
 * whenever the demo is wired to a non-premium profile so its output is never
 * presented as the intended product quality.
 */
export type DemoQualityLabel = 'intended' | 'experimental';

export interface DemoModelDecision {
  /** The model profile powering the demo DM. */
  profile: ModelProfileName;
  provider: ProviderId;
  /** Provider-specific model id (opaque to the core). */
  model: string;
  tier: ProfileTier;
  /** `intended` only when the profile is the canon-trusted premium tier. */
  quality: DemoQualityLabel;
  /** Convenience flag: `true` exactly when `quality === 'experimental'`. */
  experimental: boolean;
  /** Player-facing disclaimer; defined only for experimental runs. */
  disclaimer: string | undefined;
}

/**
 * Resolve which model the demo DM runs on and how its quality should be
 * labelled. Defaults to `premium_dm` — the intended quality. Any other profile
 * is treated as experimental and carries a disclaimer.
 */
export function resolveDemoModel(
  registry: ProfileRegistry = DEFAULT_PROFILE_REGISTRY,
  profile: ModelProfileName = 'premium_dm',
): DemoModelDecision {
  const entry = getProfile(registry, profile);
  const intended = profile === 'premium_dm' && entry.tier === 'premium';
  const quality: DemoQualityLabel = intended ? 'intended' : 'experimental';
  return {
    profile,
    provider: entry.provider,
    model: entry.model,
    tier: entry.tier,
    quality,
    experimental: !intended,
    disclaimer: intended
      ? undefined
      : `Demo running on the '${profile}' profile (${entry.tier} tier). ` +
        'Output is EXPERIMENTAL and does not represent the intended ' +
        'premium_dm quality of Loreweaver.',
  };
}

export interface DemoContentPolicy {
  /** Whether the pack may be loaded into a public, hosted demo. */
  allowed: boolean;
  readonly reasons: readonly string[];
}

/**
 * Evaluate whether a module pack is legal to load into the public demo. The
 * demo is publicly shared and hosted, so the pack must be both shippable and
 * cleared for hosted use under {@link evaluatePackPolicy}.
 */
export function evaluateDemoContent(pack: ModulePack): DemoContentPolicy {
  const policy = evaluatePackPolicy(pack.meta.license);
  const reasons = [...policy.reasons];
  if (policy.shippable && !policy.hostedAllowed) {
    reasons.push('license does not permit hosted use');
  }
  return {
    allowed: policy.shippable && policy.hostedAllowed,
    reasons,
  };
}

/**
 * Throw {@link DemoModeError} unless the pack is legal to load into the public
 * demo. Use this at the demo-campaign boundary.
 */
export function assertDemoContentAllowed(pack: ModulePack): void {
  const policy = evaluateDemoContent(pack);
  if (!policy.allowed) {
    throw new DemoModeError(
      `pack '${pack.meta.packId}' is not allowed in the public demo: ` +
        policy.reasons.join('; '),
    );
  }
}

export interface CreateDemoCampaignOptions {
  campaignId: string;
  sessionId: string;
  startedAt: string;
  /** Module to load; defaults to {@link DEFAULT_DEMO_PACK}. */
  pack?: ModulePack;
  /** Turn cap; defaults to {@link DEMO_TURN_CAP}. Must be a positive integer. */
  turnCap?: number;
  /** Profile registry; defaults to {@link DEFAULT_PROFILE_REGISTRY}. */
  profileRegistry?: ProfileRegistry;
  /** DM profile; defaults to `premium_dm` (the intended demo quality). */
  dmProfile?: ModelProfileName;
}

export interface DemoCampaign {
  campaignId: string;
  sessionId: string;
  packId: string;
  packTitle: string;
  turnCap: number;
  session: SessionRecord;
  model: DemoModelDecision;
}

/**
 * Create a bounded demo campaign: validate the pack is demo-legal, fork the
 * module template into the campaign DB, and start a fresh session. The
 * returned descriptor records the turn cap and the model-quality labelling.
 */
export function createDemoCampaign(
  db: Db,
  options: CreateDemoCampaignOptions,
): DemoCampaign {
  const pack = options.pack ?? DEFAULT_DEMO_PACK;
  const turnCap = options.turnCap ?? DEMO_TURN_CAP;
  assertPositiveTurnCap(turnCap);
  assertDemoContentAllowed(pack);

  const model = resolveDemoModel(
    options.profileRegistry ?? DEFAULT_PROFILE_REGISTRY,
    options.dmProfile ?? 'premium_dm',
  );

  // createCampaign forks the template AND records the campaign id, so a demo
  // campaign is discoverable by getCampaign and resumable like any other.
  createCampaign(db, { campaignId: options.campaignId, pack });
  const session = startSession(db, {
    campaignId: options.campaignId,
    sessionId: options.sessionId,
    startedAt: options.startedAt,
  });

  return {
    campaignId: options.campaignId,
    sessionId: options.sessionId,
    packId: pack.meta.packId,
    packTitle: pack.meta.title,
    turnCap,
    session,
    model,
  };
}

export interface DemoTurnBudget {
  turnCap: number;
  turnsUsed: number;
  /** Turns left before the cap; never negative. */
  turnsRemaining: number;
  /** `true` once the cap is reached and no further demo turn is allowed. */
  capReached: boolean;
}

/** Compute the turn budget for a given cap and turn count. */
export function demoTurnBudget(
  turnCap: number,
  turnsUsed: number,
): DemoTurnBudget {
  assertPositiveTurnCap(turnCap);
  if (!Number.isInteger(turnsUsed) || turnsUsed < 0) {
    throw new DemoModeError('demo turnsUsed must be a non-negative integer');
  }
  const turnsRemaining = Math.max(0, turnCap - turnsUsed);
  return {
    turnCap,
    turnsUsed,
    turnsRemaining,
    capReached: turnsUsed >= turnCap,
  };
}

/**
 * Compute the live turn budget from persisted scene state. A "turn" is one
 * distinct player turn recorded in `scene_log` for the session, so the budget
 * reflects actual play rather than a separate counter that could drift.
 */
export function getDemoTurnBudget(
  db: Db,
  demo: { campaignId: string; sessionId: string; turnCap: number },
): DemoTurnBudget {
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT turn_id) AS n
       FROM scene_log
       WHERE campaign_id = ? AND session_id = ? AND role = 'player'`,
    )
    .get(demo.campaignId, demo.sessionId) as { n: number };
  return demoTurnBudget(demo.turnCap, row.n);
}

/**
 * Throw {@link DemoModeError} when the demo turn cap has been reached. Callers
 * use this to gate the next turn in a bounded demo.
 */
export function assertDemoTurnAllowed(budget: DemoTurnBudget): void {
  if (budget.capReached) {
    throw new DemoModeError(
      `demo turn cap reached (${budget.turnsUsed}/${budget.turnCap}); ` +
        'start a full campaign to keep playing',
    );
  }
}

function assertPositiveTurnCap(turnCap: number): void {
  if (!Number.isInteger(turnCap) || turnCap < 1) {
    throw new DemoModeError('demo turnCap must be a positive integer');
  }
}
