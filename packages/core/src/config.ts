export interface LoreweaverConfig {
  campaignDbPath: string;
  model: string;
  anthropicApiKey: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const DEFAULT_MODEL = 'claude-opus-4-7';

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): LoreweaverConfig {
  const campaignDbPath = env.LOREWEAVER_DB_PATH?.trim();
  const anthropicApiKey = env.ANTHROPIC_API_KEY?.trim();
  const model = env.LOREWEAVER_MODEL?.trim() || DEFAULT_MODEL;

  if (!campaignDbPath) {
    throw new ConfigError('LOREWEAVER_DB_PATH is required');
  }
  if (!anthropicApiKey) {
    throw new ConfigError('ANTHROPIC_API_KEY is required');
  }
  return { campaignDbPath, model, anthropicApiKey };
}
