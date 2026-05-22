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
  MemorySummaryError,
  getArcSummary,
  getCampaignBible,
  getSessionRecap,
  listSceneSummaries,
  memoryDrilldown,
  recordSceneSummary,
  selectAlwaysOnMemory,
  rollupArcSummary,
  rollupSessionRecap,
  summarizeSceneFromLog,
} from './memory/summary.js';
export type {
  ArcSummaryInput,
  ArcSummaryKey,
  ArcSummaryRecord,
  AlwaysOnMemoryContext,
  AlwaysOnMemorySelector,
  CampaignBibleEntry,
  CampaignBibleInput,
  CampaignBibleKey,
  CampaignBibleRecord,
  MemoryRef,
  MemoryDrilldownResult,
  MemoryDrilldownSelector,
  SceneSummaryRecord,
  SceneSummarySelector,
  SessionRecapInput,
  SessionRecapRecord,
} from './memory/summary.js';
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
export {
  SceneError,
  openScene,
  closeScene,
  getScene,
  getOpenScene,
  appendSceneLog,
  listSceneLog,
  countSceneLog,
  listSceneLogWindow,
} from './orchestrator/scene.js';
export type {
  SceneStatus,
  SceneLogRole,
  SceneKey,
  SessionSelector,
  OpenSceneInput,
  CloseSceneInput,
  SceneRecord,
  SceneLogInput,
  SceneLogRecord,
  SceneLogWindowInput,
} from './orchestrator/scene.js';
export { createSeededRng } from './orchestrator/rng.js';
export type { Rng } from './orchestrator/rng.js';
export { DiceError, parseDice, rollDice } from './orchestrator/dice.js';
export type { DiceNotation, DiceRoll } from './orchestrator/dice.js';
export {
  ToolRegistry,
  DEFAULT_TOOLS,
  createDefaultToolRegistry,
} from './orchestrator/tools.js';
export type { Tool, ToolContext, ToolResult } from './orchestrator/tools.js';
export {
  assembleContext,
  renderContextMessage,
  readStateSnapshot,
} from './orchestrator/contextAssembler.js';
export type {
  ContextAssemblyInput,
  AssembledContext,
  AssembledSceneRef,
  StateSnapshot,
  CharacterSnapshot,
  InventoryItem,
  ClockSnapshot,
} from './orchestrator/contextAssembler.js';
export {
  buildSystemPrompt,
  parseToolCalls,
  renderToolResults,
} from './orchestrator/protocol.js';
export type { ParsedToolCall } from './orchestrator/protocol.js';
export { OrchestratorError, runTurn } from './orchestrator/orchestrator.js';
export type {
  RunTurnDeps,
  RunTurnInput,
  RunTurnResult,
  ExecutedToolCall,
} from './orchestrator/orchestrator.js';
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
export {
  SessionError,
  closeSession,
  getOpenSession,
  getSession,
  listSessions,
  startSession,
} from './session.js';
export type {
  CampaignSelector,
  CloseSessionInput,
  SessionKey,
  SessionRecord,
  SessionStatus,
  StartSessionInput,
} from './session.js';
export { closeSessionGracefully } from './sessionClose.js';
export type {
  CloseSessionGracefullyInput,
  CloseSessionGracefullyResult,
  GracefulSessionArcRollup,
  SessionCheckpointRunner,
} from './sessionClose.js';
export { getSessionLaunchState } from './sessionLaunch.js';
export type { SessionLaunchState } from './sessionLaunch.js';
export { CampaignError, createCampaign, getCampaign } from './campaign.js';
export type { CampaignInfo, CreateCampaignInput } from './campaign.js';
export {
  DEMO_TURN_CAP,
  DEFAULT_DEMO_PACK,
  DemoModeError,
  assertDemoContentAllowed,
  assertDemoTurnAllowed,
  createDemoCampaign,
  demoTurnBudget,
  evaluateDemoContent,
  getDemoTurnBudget,
  resolveDemoModel,
} from './demoMode.js';
export type {
  CreateDemoCampaignOptions,
  DemoCampaign,
  DemoContentPolicy,
  DemoModelDecision,
  DemoQualityLabel,
  DemoTurnBudget,
} from './demoMode.js';
export type { ModelClient, ModelMessage, ModelCompleteInput } from './model/client.js';
export { ModelClientError } from './model/client.js';
export { AgentSdkModelClient } from './model/agentSdkClient.js';
export type { AgentSdkAuth, AgentSdkAuthSource } from './model/agentSdkClient.js';
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
  EVALUATION_DIMENSIONS,
  PREMIUM_DM_EVALUATION_THRESHOLD,
  evaluateModelProfile,
} from './model/evaluation.js';
export type {
  EvaluationCostInput,
  EvaluationCostReport,
  EvaluationDimension,
  EvaluationLatencyReport,
  EvaluationReport,
  EvaluationScenario,
  EvaluationScenarioReport,
  EvaluationScores,
  EvaluationTurn,
  EvaluationTurnRecord,
  EvaluateModelProfileInput,
  PremiumDmEvaluationThreshold,
} from './model/evaluation.js';
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
export { CheckpointStore, CheckpointError } from './persistence/checkpoint/store.js';
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
export {
  buildCharacterCreationMutations,
  CharacterCreationError,
  completeCharacterCreation,
  validateCharacterDraft,
} from './characterCreation.js';
export type {
  AbilityScoreMethod,
  AbilityScoreName,
  AbilityScores,
  CharacterCreationDraft,
  CharacterCreationMutationMetadata,
  CharacterCreationResult,
  CompleteCharacterCreationInput,
  CompleteCharacterCreationResult,
  CreatedCharacter,
} from './characterCreation.js';
