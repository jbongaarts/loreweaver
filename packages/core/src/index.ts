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
export type { ModelClient, ModelMessage, ModelCompleteInput } from './model/client.js';
export { AgentSdkModelClient } from './model/agentSdkClient.js';
export {
  MODEL_PROFILES,
  PROVIDER_IDS,
  DEFAULT_PROFILE_REGISTRY,
  PREMIUM_DM_CAPABILITY_FLOOR,
  ProfileConfigError,
  isProviderId,
  getProfile,
  resolveProfileRegistry,
} from './model/profiles.js';
export type {
  ModelProfileName,
  ProviderId,
  ProfileTier,
  ProfileEntry,
  ProfileRegistry,
} from './model/profiles.js';
export {
  SeparationError,
  assertSeparateFromBeads,
  BEADS_RESERVED_REF,
} from './persistence/checkpoint/separation.js';
export { serializeCampaign, canonicalize } from './persistence/checkpoint/serialize.js';
export type { SnapshotRecord } from './persistence/checkpoint/serialize.js';
