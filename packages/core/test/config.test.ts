import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';
import { DEFAULT_PROFILE_REGISTRY } from '../src/model/profiles.js';

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
      dmProfile: DEFAULT_PROFILE_REGISTRY.premium_dm,
      anthropicApiKey: 'sk-test',
    });
  });

  it('defaults the model to the premium_dm profile when unset', () => {
    const cfg = loadConfig({
      LOREWEAVER_DB_PATH: './x.db',
      ANTHROPIC_API_KEY: 'sk-test',
    });
    expect(cfg.model).toBe(DEFAULT_PROFILE_REGISTRY.premium_dm.model);
    expect(cfg.dmProfile).toEqual(DEFAULT_PROFILE_REGISTRY.premium_dm);
  });

  it('resolves the runtime DM model from a premium_dm profile override', () => {
    const cfg = loadConfig({
      LOREWEAVER_DB_PATH: './x.db',
      ANTHROPIC_API_KEY: 'sk-test',
      LOREWEAVER_PROFILE_PREMIUM_DM_MODEL: 'claude-future-1',
    });
    expect(cfg.model).toBe('claude-future-1');
    expect(cfg.dmProfile.model).toBe('claude-future-1');
  });

  it('lets the legacy flat LOREWEAVER_MODEL override win over the profile', () => {
    const cfg = loadConfig({
      LOREWEAVER_DB_PATH: './x.db',
      ANTHROPIC_API_KEY: 'sk-test',
      LOREWEAVER_MODEL: 'claude-flat-override',
      LOREWEAVER_PROFILE_PREMIUM_DM_MODEL: 'claude-profile-model',
    });
    expect(cfg.model).toBe('claude-flat-override');
    // The resolved profile entry still reflects the profile-level override.
    expect(cfg.dmProfile.model).toBe('claude-profile-model');
  });

  it('throws ConfigError when the premium_dm profile selects a non-anthropic provider', () => {
    expect(() =>
      loadConfig({
        LOREWEAVER_DB_PATH: './x.db',
        ANTHROPIC_API_KEY: 'sk-test',
        LOREWEAVER_PROFILE_PREMIUM_DM_PROVIDER: 'openai',
      }),
    ).toThrow(ConfigError);
  });

  it('throws ConfigError when a profile provider override is not a known provider id', () => {
    expect(() =>
      loadConfig({
        LOREWEAVER_DB_PATH: './x.db',
        ANTHROPIC_API_KEY: 'sk-test',
        LOREWEAVER_PROFILE_PREMIUM_DM_PROVIDER: 'not-a-provider',
      }),
    ).toThrow(ConfigError);
  });

  it('throws ConfigError when LOREWEAVER_DB_PATH is missing', () => {
    expect(() => loadConfig({ ANTHROPIC_API_KEY: 'sk-test' })).toThrow(ConfigError);
  });

  it('throws ConfigError when ANTHROPIC_API_KEY is missing', () => {
    expect(() => loadConfig({ LOREWEAVER_DB_PATH: './x.db' })).toThrow(ConfigError);
  });
});
