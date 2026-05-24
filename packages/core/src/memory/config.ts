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
