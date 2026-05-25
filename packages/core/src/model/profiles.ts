/**
 * Provider-neutral model profile configuration.
 *
 * Loreweaver routes different tasks to different model "profiles" describing
 * CAPABILITY NEEDS, not provider names. A profile is mapped to a provider
 * adapter (selected by a neutral identifier) plus a model id. No code here
 * imports any vendor SDK — the only file permitted to touch the Claude Agent
 * SDK is `agentSdkClient.ts`. Adapter selection is by string identifier so the
 * core stays provider-agnostic; concrete adapters are wired up downstream.
 *
 * This module only makes profiles + provider selection representable and
 * configurable. Runtime model routing / evaluation harness is out of scope
 * (downstream bead ws9.1).
 */

/**
 * The seven capability-based model profiles. These describe what a task NEEDS,
 * independent of which provider ultimately serves it.
 *
 * - premium_dm            primary Dungeon Master narration + canon-changing turns
 * - state_extractor       structured state extraction from narration
 * - summarizer            draft / rollup summaries (auxiliary)
 * - rules_adjudicator     rules reasoning / adjudication support
 * - memory_reconciler     memory pyramid reconciliation
 * - embedding_provider    vector embeddings for retrieval
 * - economy_or_experimental cheap/experimental bounded tasks that CANNOT corrupt canon
 */
export const MODEL_PROFILES = [
  'premium_dm',
  'state_extractor',
  'summarizer',
  'rules_adjudicator',
  'memory_reconciler',
  'embedding_provider',
  'economy_or_experimental',
] as const;

export type ModelProfileName = (typeof MODEL_PROFILES)[number];

/**
 * Provider adapters selectable per profile, by neutral identifier. These are
 * NOT implemented here — they only make adapter selection representable. The
 * one concrete adapter that exists today is the Claude Agent SDK adapter
 * (`AgentSdkModelClient`), which corresponds to the `anthropic` identifier.
 */
export const PROVIDER_IDS = [
  'anthropic',
  'openai',
  'bedrock',
  'gemini',
  'openrouter',
  'local',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

/** Quality tier of a profile entry. */
export type ProfileTier = 'premium' | 'standard' | 'auxiliary' | 'experimental';

export interface ProfileEntry {
  /** Neutral provider-adapter identifier used to select an adapter. */
  provider: ProviderId;
  /** Provider-specific model id (opaque to the core). */
  model: string;
  /** Quality tier; `premium` is the canon-trusted DM-grade tier. */
  tier: ProfileTier;
  /**
   * Whether this profile is permitted to perform canon-changing operations.
   * Canon-changing operations require a `premium` tier model (or downstream
   * validation before commit). Economy/experimental profiles MUST be `false`.
   */
  canonChanging: boolean;
  /**
   * Documented quality/capability expectation. REQUIRED on `premium_dm`
   * (acceptance #3): it states an explicit capability FLOOR, not a price floor.
   */
  capabilityFloor?: string;
  /** Human-readable note on intended use / constraints. */
  notes?: string;
}

export type ProfileRegistry = Record<ModelProfileName, ProfileEntry>;

/**
 * `premium_dm` capability-floor expectation (acceptance #3, discoverable in
 * code, not only prose):
 *
 * The primary DM profile targets Opus 4.6+ / GPT-5.5-class quality or a future
 * equivalent — a CAPABILITY FLOOR, not a price floor. Canon-changing
 * operations require the premium model or validation before commit. Economy
 * models are not the default DM and must not power the primary public demo
 * unless explicitly labeled experimental. Cheaper models are acceptable only
 * for bounded auxiliary tasks that cannot directly corrupt canon.
 */
export const PREMIUM_DM_CAPABILITY_FLOOR =
  'Opus 4.6+ / GPT-5.5-class quality or a future equivalent — a capability ' +
  'floor, not a price floor. Canon-changing operations require this premium ' +
  'tier (or validation before commit); economy models must never silently ' +
  'serve the primary DM or the public demo.';

/**
 * Default, provider-neutral profile registry. The `anthropic` provider maps to
 * the existing Claude Agent SDK adapter today; other providers are selectable
 * but not yet implemented. Defaults intentionally keep the existing flat-config
 * Anthropic model as the premium DM model for backward compatibility.
 */
export const DEFAULT_PROFILE_REGISTRY: ProfileRegistry = {
  premium_dm: {
    provider: 'anthropic',
    model: 'claude-opus-4-7',
    tier: 'premium',
    canonChanging: true,
    capabilityFloor: PREMIUM_DM_CAPABILITY_FLOOR,
    notes: 'Primary Dungeon Master. Canon-trusted; do not downgrade silently.',
  },
  state_extractor: {
    provider: 'anthropic',
    model: 'claude-opus-4-7',
    tier: 'standard',
    canonChanging: false,
    notes: 'Structured extraction; outputs validated before any canon write.',
  },
  summarizer: {
    provider: 'anthropic',
    model: 'claude-opus-4-7',
    tier: 'auxiliary',
    canonChanging: false,
    notes: 'Draft/rollup summaries; bounded auxiliary task.',
  },
  rules_adjudicator: {
    provider: 'anthropic',
    model: 'claude-opus-4-7',
    tier: 'standard',
    canonChanging: false,
    notes: 'Rules reasoning support; deterministic tools own the final math.',
  },
  memory_reconciler: {
    provider: 'anthropic',
    model: 'claude-opus-4-7',
    tier: 'standard',
    canonChanging: false,
    notes: 'Memory pyramid reconciliation; reconciled writes are validated.',
  },
  embedding_provider: {
    provider: 'anthropic',
    model: 'claude-opus-4-7',
    tier: 'auxiliary',
    canonChanging: false,
    notes: 'Retrieval embeddings; no narrative authority.',
  },
  economy_or_experimental: {
    provider: 'anthropic',
    model: 'claude-opus-4-7',
    tier: 'experimental',
    canonChanging: false,
    notes:
      'Cheap/experimental bounded tasks only (intent classification, ' +
      'retrieval routing, candidate extraction, formatting). Must NOT power ' +
      'the primary DM or public demo and cannot directly corrupt canon.',
  },
};

export class ProfileConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileConfigError';
  }
}

/** Type guard for neutral provider identifiers. */
export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

/** Look up the resolved entry for a profile by name. */
export function getProfile(
  registry: ProfileRegistry,
  profile: ModelProfileName,
): ProfileEntry {
  return registry[profile];
}

function envKey(
  profile: ModelProfileName,
  suffix: 'PROVIDER' | 'MODEL',
): string {
  return `LOREWEAVER_PROFILE_${profile.toUpperCase()}_${suffix}`;
}

/**
 * Resolve the profile registry, applying optional per-profile overrides from
 * the environment. Each profile supports:
 *   LOREWEAVER_PROFILE_<PROFILE>_PROVIDER  (a neutral provider id)
 *   LOREWEAVER_PROFILE_<PROFILE>_MODEL     (a provider-specific model id)
 * Unset overrides fall back to {@link DEFAULT_PROFILE_REGISTRY}.
 *
 * Overrides intentionally do NOT recompute `tier`/`canonChanging`: pointing a
 * profile at a cheaper provider/model never relaxes its declared capability
 * tier, and capability-floor enforcement is deferred to downstream bead ws9.1.
 */
export function resolveProfileRegistry(
  env: Record<string, string | undefined> = process.env,
): ProfileRegistry {
  const resolved = {} as ProfileRegistry;
  for (const profile of MODEL_PROFILES) {
    const base = DEFAULT_PROFILE_REGISTRY[profile];
    const providerOverride = env[envKey(profile, 'PROVIDER')]?.trim();
    const modelOverride = env[envKey(profile, 'MODEL')]?.trim();

    let provider = base.provider;
    if (providerOverride) {
      if (!isProviderId(providerOverride)) {
        throw new ProfileConfigError(
          `${envKey(profile, 'PROVIDER')} is not a known provider id: ` +
            `'${providerOverride}' (expected one of ${PROVIDER_IDS.join(', ')})`,
        );
      }
      provider = providerOverride;
    }

    resolved[profile] = {
      ...base,
      provider,
      ...(modelOverride ? { model: modelOverride } : {}),
    };
  }
  return resolved;
}
