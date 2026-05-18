import { describe, expect, it } from 'vitest';
import { buildBanner } from '../src/index.js';

describe('cli', () => {
  it('builds a banner that includes the core version', () => {
    expect(buildBanner('1.2.3')).toBe('Loreweaver — core v1.2.3');
  });
});
