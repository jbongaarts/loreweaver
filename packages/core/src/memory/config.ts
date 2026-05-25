export interface MemoryConfig {
  /** N — sessions per arc before mechanical rollover. */
  arcRolloverThreshold: number;
  /** K — most-recent session recaps inlined verbatim in every assembled context. */
  recapWindowSize: number;
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  arcRolloverThreshold: 5,
  recapWindowSize: 5,
};

/**
 * Validate a {@link MemoryConfig}. Both knobs must be positive integers:
 * a zero or negative arcRolloverThreshold would attempt rollover with no
 * accumulated sessions on every close, and a zero or negative recapWindowSize
 * would assemble an empty recap window every turn. Non-integer values are
 * rejected because both are used as counts of discrete sessions.
 *
 * Throws on any out-of-range value. Returns the config unchanged on success so
 * callers can do `validateMemoryConfig(cfg)` inline.
 */
export function validateMemoryConfig(config: MemoryConfig): MemoryConfig {
  assertPositiveInteger('arcRolloverThreshold', config.arcRolloverThreshold);
  assertPositiveInteger('recapWindowSize', config.recapWindowSize);
  return config;
}

function assertPositiveInteger(field: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `MemoryConfig.${field} must be a positive integer, got ${value}`,
    );
  }
}
