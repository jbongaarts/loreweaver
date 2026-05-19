export const CORE_VERSION = '0.0.0';
export { loadConfig, ConfigError } from './config.js';
export type { LoreweaverConfig } from './config.js';
export { openDatabase, withTransaction } from './persistence/db.js';
export type { Db } from './persistence/db.js';
export { initSchema, SCHEMA_VERSION } from './persistence/schema.js';
export {
  TurnTraceError,
  getTurnTrace,
  recordTurnTrace,
} from './memory/turnTrace.js';
export type {
  TraceJsonValue,
  TurnTraceConsentScope,
  TurnTraceKey,
  TurnTraceRecord,
} from './memory/turnTrace.js';
export {
  getStateProvenance,
  mutateState,
  mutateStateBatch,
  MutateStateError,
} from './state/mutateState.js';
export type {
  MutateStateBatchOptions,
  MutateStateInput,
  MutateStateOp,
  MutateStateTarget,
  MutateStateValue,
  StateProvenanceQuery,
  StateProvenanceRecord,
} from './state/mutateState.js';
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
  normalizeRemoteUrl,
  readDoltRemotes,
  BEADS_RESERVED_REF,
} from './persistence/checkpoint/separation.js';
export type { DoltRemote } from './persistence/checkpoint/separation.js';
export { serializeCampaign, canonicalize } from './persistence/checkpoint/serialize.js';
export type { SnapshotRecord } from './persistence/checkpoint/serialize.js';
export { DoltRepo } from './persistence/checkpoint/doltRepo.js';
export type { Checkpoint } from './persistence/checkpoint/doltRepo.js';
export {
  resolveDoltBinary,
  managedDoltDir,
  DoltUnavailableError,
} from './persistence/checkpoint/doltBinary.js';
export type { ResolveDoltOptions } from './persistence/checkpoint/doltBinary.js';
export {
  DOLT_PINNED_VERSION,
  DoltUnverifiedError,
  doltAssetFor,
  sha256File,
  verifyArchive,
  provisionDolt,
  ensureDoltAvailable,
  extractInvocation,
} from './persistence/checkpoint/doltProvision.js';
export type {
  DoltAsset,
  ProvisionOptions,
  DoltInstallReason,
  DoltInstallPrompt,
  DoltConfirmFn,
  EnsureDoltOptions,
} from './persistence/checkpoint/doltProvision.js';
export { CheckpointStore } from './persistence/checkpoint/store.js';
export { validateModulePack, WorldModuleError } from './world/validate.js';
export {
  parseModulePack,
  loadModuleFromDir,
  MODULE_FILE,
} from './world/loadModule.js';
export { forkModuleIntoCampaign } from './world/forkCampaign.js';
export { worldQuery, worldOverlayKey } from './world/worldQuery.js';
export {
  evaluatePackPolicy,
  assertShippablePack,
} from './world/license.js';
export type { PackUsePolicy } from './world/license.js';
export { EMBERFALL_HOLLOW } from './world/samples/emberfallHollow.js';
export type {
  ModulePack,
  ModuleMeta,
  PackLicense,
  PackLicenseClass,
  PackType,
  Location,
  LocationExit,
  Encounter,
  EncounterCreature,
  Npc,
  Trigger,
  Lore,
  LoreScope,
  WorldTargetType,
  WorldQueryTarget,
  WorldQueryResult,
  WorldOverlay,
} from './world/types.js';
export { SRD_CATALOG, SRD_LICENSE } from './srd/data.js';
export { lookupSrd } from './srd/lookup.js';
export { buildSrdIndex, lookupSrdRecord } from './srd/store.js';
export type {
  SrdBaseRecord,
  SrdCatalog,
  SrdClassRecord,
  SrdKind,
  SrdLicenseMetadata,
  SrdLookupInput,
  SrdLookupResult,
  SrdMonsterRecord,
  SrdRecord,
  SrdSpellRecord,
} from './srd/types.js';
