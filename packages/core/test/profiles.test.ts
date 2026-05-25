import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROFILE_REGISTRY,
  MODEL_PROFILES,
  PROVIDER_IDS,
  ProfileConfigError,
  getProfile,
  resolveProfileRegistry,
} from '../src/model/profiles.js';

describe('model profiles', () => {
  it('declares exactly the seven capability-based profiles', () => {
    expect([...MODEL_PROFILES].sort()).toEqual(
      [
        'economy_or_experimental',
        'embedding_provider',
        'memory_reconciler',
        'premium_dm',
        'rules_adjudicator',
        'state_extractor',
        'summarizer',
      ].sort(),
    );
  });

  it('declares provider adapters by neutral identifiers (no SDK/provider coupling in names)', () => {
    expect([...PROVIDER_IDS].sort()).toEqual(
      [
        'anthropic',
        'openai',
        'bedrock',
        'gemini',
        'openrouter',
        'local',
      ].sort(),
    );
  });

  it('default registry maps every profile to a selectable provider adapter', () => {
    for (const profile of MODEL_PROFILES) {
      const entry = DEFAULT_PROFILE_REGISTRY[profile];
      expect(entry).toBeDefined();
      expect(PROVIDER_IDS).toContain(entry.provider);
      expect(typeof entry.model).toBe('string');
      expect(entry.model.length).toBeGreaterThan(0);
    }
  });

  it('premium_dm carries documented quality/capability-floor expectations', () => {
    const premium = DEFAULT_PROFILE_REGISTRY.premium_dm;
    expect(premium.capabilityFloor).toBeDefined();
    expect(premium.capabilityFloor).toMatch(/Opus 4\.6|GPT-5\.5/i);
    expect(premium.canonChanging).toBe(true);
    // Premium DM must not be an economy/experimental tier.
    expect(premium.tier).toBe('premium');
  });

  it('economy_or_experimental is flagged as not-canon-safe and experimental tier', () => {
    const eco = DEFAULT_PROFILE_REGISTRY.economy_or_experimental;
    expect(eco.canonChanging).toBe(false);
    expect(eco.tier).toBe('experimental');
  });

  it('getProfile returns the resolved entry for a profile name', () => {
    const entry = getProfile(DEFAULT_PROFILE_REGISTRY, 'summarizer');
    expect(entry).toEqual(DEFAULT_PROFILE_REGISTRY.summarizer);
  });

  it('resolveProfileRegistry allows per-profile provider/model override via env', () => {
    const reg = resolveProfileRegistry({
      LOREWEAVER_PROFILE_PREMIUM_DM_PROVIDER: 'bedrock',
      LOREWEAVER_PROFILE_PREMIUM_DM_MODEL: 'some-bedrock-model',
    });
    expect(reg.premium_dm.provider).toBe('bedrock');
    expect(reg.premium_dm.model).toBe('some-bedrock-model');
    // Untouched profiles keep defaults.
    expect(reg.summarizer).toEqual(DEFAULT_PROFILE_REGISTRY.summarizer);
  });

  it('resolveProfileRegistry rejects an unknown provider id', () => {
    expect(() =>
      resolveProfileRegistry({
        LOREWEAVER_PROFILE_SUMMARIZER_PROVIDER: 'not-a-provider',
      }),
    ).toThrow(ProfileConfigError);
  });

  it('resolveProfileRegistry falls back to defaults with no env', () => {
    expect(resolveProfileRegistry({})).toEqual(DEFAULT_PROFILE_REGISTRY);
  });
});
