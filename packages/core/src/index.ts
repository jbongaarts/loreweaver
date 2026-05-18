export const CORE_VERSION = '0.0.0';
export { loadConfig, ConfigError } from './config.js';
export type { LoreweaverConfig } from './config.js';
export { openDatabase, withTransaction } from './persistence/db.js';
export type { Db } from './persistence/db.js';
export { initSchema, SCHEMA_VERSION } from './persistence/schema.js';
export { SEAMS } from './seams.js';
export type {
  SeamName,
  Persistence,
  WorldSubsystem,
  MemorySubsystem,
  ToolLayer,
  ContextAssembler,
  Orchestrator,
} from './seams.js';
