import { describe, expect, it } from 'vitest';
import {
  SeparationError,
  assertSeparateFromBeads,
  BEADS_RESERVED_REF,
} from '../src/persistence/checkpoint/separation.js';

describe('beads-Dolt separation guard', () => {
  it('allows a clearly disjoint dolt dir', () => {
    expect(() =>
      assertSeparateFromBeads('/proj/.loreweaver/dolt', '/proj/.beads'),
    ).not.toThrow();
  });

  it('rejects a dolt dir equal to the beads dir', () => {
    expect(() => assertSeparateFromBeads('/proj/.beads', '/proj/.beads')).toThrow(
      SeparationError,
    );
  });

  it('rejects a dolt dir nested inside the beads dir', () => {
    expect(() =>
      assertSeparateFromBeads('/proj/.beads/dolt', '/proj/.beads'),
    ).toThrow(SeparationError);
  });

  it('rejects a dolt dir that contains the beads dir', () => {
    expect(() => assertSeparateFromBeads('/proj', '/proj/.beads')).toThrow(
      SeparationError,
    );
  });

  it('exposes the reserved beads ref so callers never reuse it', () => {
    expect(BEADS_RESERVED_REF).toBe('refs/dolt/data');
  });
});
