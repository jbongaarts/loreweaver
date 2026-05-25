import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MEMORY_CONFIG,
  validateMemoryConfig,
} from '../src/internal.js';

describe('DEFAULT_MEMORY_CONFIG', () => {
  it('has arcRolloverThreshold=5 and recapWindowSize=5', () => {
    expect(DEFAULT_MEMORY_CONFIG).toEqual({
      arcRolloverThreshold: 5,
      recapWindowSize: 5,
    });
  });
});

describe('validateMemoryConfig', () => {
  it('accepts the default config and returns it unchanged', () => {
    expect(validateMemoryConfig(DEFAULT_MEMORY_CONFIG)).toBe(
      DEFAULT_MEMORY_CONFIG,
    );
  });

  it('accepts other positive-integer configs', () => {
    const cfg = { arcRolloverThreshold: 1, recapWindowSize: 10 };
    expect(validateMemoryConfig(cfg)).toBe(cfg);
  });

  it('throws when arcRolloverThreshold is zero', () => {
    expect(() =>
      validateMemoryConfig({ arcRolloverThreshold: 0, recapWindowSize: 5 }),
    ).toThrow(/arcRolloverThreshold/);
  });

  it('throws when arcRolloverThreshold is negative', () => {
    expect(() =>
      validateMemoryConfig({ arcRolloverThreshold: -1, recapWindowSize: 5 }),
    ).toThrow(/arcRolloverThreshold/);
  });

  it('throws when arcRolloverThreshold is non-integer', () => {
    expect(() =>
      validateMemoryConfig({ arcRolloverThreshold: 2.5, recapWindowSize: 5 }),
    ).toThrow(/arcRolloverThreshold/);
  });

  it('throws when recapWindowSize is zero', () => {
    expect(() =>
      validateMemoryConfig({ arcRolloverThreshold: 5, recapWindowSize: 0 }),
    ).toThrow(/recapWindowSize/);
  });

  it('throws when recapWindowSize is negative', () => {
    expect(() =>
      validateMemoryConfig({ arcRolloverThreshold: 5, recapWindowSize: -3 }),
    ).toThrow(/recapWindowSize/);
  });

  it('throws when recapWindowSize is non-integer', () => {
    expect(() =>
      validateMemoryConfig({ arcRolloverThreshold: 5, recapWindowSize: 1.5 }),
    ).toThrow(/recapWindowSize/);
  });
});
