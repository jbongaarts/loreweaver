/**
 * Code-owned deterministic RNG (E5). Dice and any other randomness in the turn
 * loop draw from this — never from the model — so a turn is reproducible under
 * a fixed seed in tests and re-playable from a turn trace.
 *
 * Implementation: mulberry32, a small fast 32-bit generator. Adequate for game
 * dice; not cryptographic.
 */
export interface Rng {
  /** Uniform integer in `[0, maxExclusive)`. */
  nextInt(maxExclusive: number): number;
}

export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    nextInt(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new RangeError('maxExclusive must be a positive integer');
      }
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const float = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return Math.floor(float * maxExclusive);
    },
  };
}
