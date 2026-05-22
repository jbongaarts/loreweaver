import {
  ProfileConfigError,
  resolveProfileRegistry,
  type ProfileEntry,
  type ProfileRegistry,
} from './model/profiles.js';

export interface LoreweaverConfig {
  campaignDbPath: string;
  /**
   * Resolved primary-DM model id. This is the `premium_dm` profile's model,
   * unless the legacy flat `LOREWEAVER_MODEL` override is set — that still
   * wins, for backward compatibility with the pre-registry flat config path.
   */
  model: string;
  /**
   * Resolved `premium_dm` profile entry (provider + model + tier) from the
   * profile registry, including any `LOREWEAVER_PROFILE_PREMIUM_DM_*` overrides.
   */
  dmProfile: ProfileEntry;
  anthropicApiKey: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): LoreweaverConfig {
  const campaignDbPath = env.LOREWEAVER_DB_PATH?.trim();
  const anthropicApiKey = env.ANTHROPIC_API_KEY?.trim();

  if (!campaignDbPath) {
    throw new ConfigError('LOREWEAVER_DB_PATH is required');
  }
  if (!anthropicApiKey) {
    throw new ConfigError('ANTHROPIC_API_KEY is required');
  }

  // The primary-DM model is resolved from the provider-neutral profile
  // registry. resolveProfileRegistry reports malformed profile overrides via
  // ProfileConfigError; surface those through the CLI's single ConfigError
  // channel so they reach formatConfigError like any other config failure.
  let registry: ProfileRegistry;
  try {
    registry = resolveProfileRegistry(env);
  } catch (err) {
    if (err instanceof ProfileConfigError) {
      throw new ConfigError(err.message);
    }
    throw err;
  }
  const dmProfile = registry.premium_dm;

  // LOREWEAVER_MODEL is the legacy flat override and still wins when set;
  // otherwise the runtime DM model comes from the premium_dm profile entry
  // (its own LOREWEAVER_PROFILE_PREMIUM_DM_MODEL override, or the default).
  const model = env.LOREWEAVER_MODEL?.trim() || dmProfile.model;

  // The CLI ships only the Claude Agent SDK adapter, so the resolved DM
  // profile must select the `anthropic` provider. A non-anthropic override
  // would otherwise be silently ignored.
  if (dmProfile.provider !== 'anthropic') {
    throw new ConfigError(
      `premium_dm profile resolves to provider '${dmProfile.provider}', but ` +
        'the CLI ships only the Anthropic (Claude Agent SDK) adapter. Unset ' +
        'LOREWEAVER_PROFILE_PREMIUM_DM_PROVIDER or set it to "anthropic".',
    );
  }

  return { campaignDbPath, model, dmProfile, anthropicApiKey };
}
