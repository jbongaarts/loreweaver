import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('returns a valid config from a complete env', () => {
    const cfg = loadConfig({
      LOREWEAVER_DB_PATH: './campaigns/x.db',
      LOREWEAVER_MODEL: 'claude-opus-4-7',
      ANTHROPIC_API_KEY: 'sk-test',
    });
    expect(cfg).toEqual({
      campaignDbPath: './campaigns/x.db',
      model: 'claude-opus-4-7',
      anthropicApiKey: 'sk-test',
    });
  });

  it('defaults the model when unset', () => {
    const cfg = loadConfig({
      LOREWEAVER_DB_PATH: './x.db',
      ANTHROPIC_API_KEY: 'sk-test',
    });
    expect(cfg.model).toBe('claude-opus-4-7');
  });

  it('throws ConfigError when LOREWEAVER_DB_PATH is missing', () => {
    expect(() => loadConfig({ ANTHROPIC_API_KEY: 'sk-test' })).toThrow(ConfigError);
  });

  it('throws ConfigError when ANTHROPIC_API_KEY is missing', () => {
    expect(() => loadConfig({ LOREWEAVER_DB_PATH: './x.db' })).toThrow(ConfigError);
  });
});
