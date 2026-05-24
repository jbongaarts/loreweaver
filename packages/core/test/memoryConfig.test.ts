import { describe, it, expect } from 'vitest';
import { DEFAULT_MEMORY_CONFIG } from '../src/internal.js';

describe('DEFAULT_MEMORY_CONFIG', () => {
  it('has arcRolloverThreshold=5 and recapWindowSize=5', () => {
    expect(DEFAULT_MEMORY_CONFIG).toEqual({
      arcRolloverThreshold: 5,
      recapWindowSize: 5,
    });
  });
});
