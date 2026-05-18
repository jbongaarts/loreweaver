import { describe, expect, it } from 'vitest';
import { CORE_VERSION } from '../src/index.js';

describe('toolchain smoke', () => {
  it('exposes a core version string', () => {
    expect(typeof CORE_VERSION).toBe('string');
    expect(CORE_VERSION.length).toBeGreaterThan(0);
  });
});
