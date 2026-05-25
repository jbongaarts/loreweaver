/**
 * `@loreweaver/core/internal` — non-stable surface.
 *
 * Everything re-exported below is **explicitly unstable**: low-level
 * primitives, raw datasets, model-profile/benchmarking helpers, world/rules
 * loaders, dolt provisioning innards, scaffolding for architectural seams,
 * and system-specific character-creation pieces. Names, signatures, and
 * locations may change in any release with no migration path.
 *
 * Use the stable root export (`@loreweaver/core`) from production code.
 * Imports of this subpath belong in co-developed callers inside this
 * repository (tests, evaluation tooling) that genuinely need to assert
 * against implementation details. See the header of `./index.ts` for the
 * stability contract.
 *
 * For convenience to those in-repo callers this subpath also re-exports the
 * stable surface, so a single import from `@loreweaver/core/internal` (or, for
 * core's own tests, `'../src/internal.js'`) covers both buckets.
 */

export * from './index.js';

// Database internals.
export { withTransaction } from './persistence/db.js';

// Turn trace recorder.
export {
  TurnTraceError,
  getTurnTrace,
  listTurnTraces,
  recordTurnTrace,
} from './memory/turnTrace.js';
export type {
  TraceJsonValue,
  TurnTraceConsentScope,
  TurnTraceKey,
  TurnTraceRecord,
} from './memory/turnTrace.js';

// Memory configuration (N and K knobs for arc rollover and recap window).
export {
  DEFAULT_MEMORY_CONFIG,
  validateMemoryConfig,
  type MemoryConfig,
} from './memory/config.js';

// Campaign arc lifecycle (read-side + idempotent open + atomic rollover).
export {
  openArcIfMissing,
  getOpenArc,
  getClosedArcCount,
  getClosedSessionsInOpenArc,
  stampSessionWithOpenArc,
  listClosedArcSummaries,
  closeOpenArcAndOpenNext,
} from './memory/campaignArc.js';
export type {
  CampaignArcRecord,
  CampaignSessionInArc,
  OpenArcIfMissingInput,
  CloseOpenArcAndOpenNextInput,
  CloseOpenArcAndOpenNextResult,
} from './memory/campaignArc.js';

// Memory low-level primitives (scene summaries, drilldown, always-on
// selection, low-level rollups).
export {
  MemorySummaryError,
  listSceneSummaries,
  memoryDrilldown,
  recordSceneSummary,
  rollupSessionRecap,
  selectAlwaysOnMemory,
  summarizeSceneFromLog,
} from './memory/summary.js';
export type {
  AlwaysOnMemoryContext,
  AlwaysOnMemorySelector,
  MemoryDrilldownResult,
  MemoryDrilldownSelector,
  MemoryRef,
  SceneSummaryRecord,
  SceneSummarySelector,
} from './memory/summary.js';

// State mutation primitives.
export {
  MutateStateError,
  getStateProvenance,
  mutateState,
  mutateStateBatch,
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

// Scene + scene-log primitives.
export {
  SceneError,
  appendSceneLog,
  closeScene,
  countSceneLog,
  getOpenScene,
  getScene,
  listSceneLog,
  listSceneLogWindow,
  openScene,
} from './orchestrator/scene.js';
export type {
  CloseSceneInput,
  OpenSceneInput,
  SceneKey,
  SceneLogInput,
  SceneLogRecord,
  SceneLogRole,
  SceneLogWindowInput,
  SceneRecord,
  SceneStatus,
  SessionSelector,
} from './orchestrator/scene.js';

// Deterministic RNG used by tools/dice.
export { createSeededRng } from './orchestrator/rng.js';
export type { Rng } from './orchestrator/rng.js';

// Dice notation parser + roller.
export { DiceError, parseDice, rollDice } from './orchestrator/dice.js';
export type { DiceNotation, DiceRoll } from './orchestrator/dice.js';

// Tool-data helpers (the registry itself is stable; these are internals).
export { isMarkSceneToolData } from './orchestrator/tools.js';
export type { MarkSceneToolData } from './orchestrator/tools.js';

// Context assembler + state-snapshot reader.
export {
  assembleContext,
  readStateSnapshot,
  renderContextMessage,
} from './orchestrator/contextAssembler.js';
export type {
  AssembledContext,
  AssembledSceneRef,
  CharacterSnapshot,
  ClockSnapshot,
  ContextAssemblyInput,
  InventoryItem,
  StateSnapshot,
} from './orchestrator/contextAssembler.js';

// DM-protocol prompt building and tool-call parsing.
export {
  buildSystemPrompt,
  parseToolCalls,
  renderToolResults,
} from './orchestrator/protocol.js';
export type { ParsedToolCall } from './orchestrator/protocol.js';

// Architectural seams scaffold.
export { SEAMS } from './seams.js';
export type {
  ContextAssembler,
  MemorySubsystem,
  Orchestrator,
  Persistence,
  SeamName,
  ToolLayer,
  WorldSubsystem,
} from './seams.js';

// Demo-mode policy + budget helpers (the high-level entrypoints are stable).
export {
  assertDemoContentAllowed,
  assertDemoTurnAllowed,
  demoTurnBudget,
  evaluateDemoContent,
  resolveDemoModel,
} from './demoMode.js';

// Model profiles + evaluation harness.
export {
  DEFAULT_PROFILE_REGISTRY,
  MODEL_PROFILES,
  PREMIUM_DM_CAPABILITY_FLOOR,
  PROVIDER_IDS,
  ProfileConfigError,
  getProfile,
  isProviderId,
  resolveProfileRegistry,
} from './model/profiles.js';
export type {
  ModelProfileName,
  ProfileEntry,
  ProfileRegistry,
  ProfileTier,
  ProviderId,
} from './model/profiles.js';
export {
  EVALUATION_DIMENSIONS,
  PREMIUM_DM_EVALUATION_THRESHOLD,
  evaluateModelProfile,
} from './model/evaluation.js';
export type {
  EvaluateModelProfileInput,
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
  PremiumDmEvaluationThreshold,
} from './model/evaluation.js';

// Checkpoint internals (separation guard, snapshot serialization, raw dolt
// install/provision helpers).
export {
  BEADS_RESERVED_REF,
  SeparationError,
  assertSeparateFromBeads,
  normalizeRemoteUrl,
  readDoltRemotes,
} from './persistence/checkpoint/separation.js';
export type { DoltRemote } from './persistence/checkpoint/separation.js';
export {
  canonicalize,
  serializeCampaign,
} from './persistence/checkpoint/serialize.js';
export type { SnapshotRecord } from './persistence/checkpoint/serialize.js';
export {
  managedDoltDir,
  resolveDoltBinary,
} from './persistence/checkpoint/doltBinary.js';
export type { ResolveDoltOptions } from './persistence/checkpoint/doltBinary.js';
export {
  DOLT_PINNED_VERSION,
  DoltUnverifiedError,
  doltAssetFor,
  extractInvocation,
  provisionDolt,
  sha256File,
  verifyArchive,
} from './persistence/checkpoint/doltProvision.js';
export type {
  DoltAsset,
  DoltConfirmFn,
  ProvisionOptions,
} from './persistence/checkpoint/doltProvision.js';

// World module loader + validator + license/policy helpers.
export { WorldModuleError, validateModulePack } from './world/validate.js';
export {
  MODULE_FILE,
  loadModuleFromDir,
  parseModulePack,
} from './world/loadModule.js';
export { forkModuleIntoCampaign } from './world/forkCampaign.js';
export { worldOverlayKey, worldQuery } from './world/worldQuery.js';
export {
  assertShippablePack,
  evaluatePackPolicy,
} from './world/license.js';
export type { PackUsePolicy } from './world/license.js';
export type {
  Encounter,
  EncounterCreature,
  Location,
  LocationExit,
  Lore,
  LoreScope,
  Npc,
  Trigger,
  WorldOverlay,
  WorldQueryResult,
  WorldQueryTarget,
  WorldTargetType,
} from './world/types.js';

// Rules engine internals (pack validation, license policy, stack resolution,
// record lookup, record-shape types).
export { validateRulesPack } from './rules/validate.js';
export {
  assertShippableRulesPack,
  evaluateRulesPackPolicy,
} from './rules/license.js';
export type { RulesPackUsePolicy } from './rules/license.js';
export { normalizeRulesRecordName, resolveRulesStack } from './rules/stack.js';
export type {
  ResolveRulesStackInput,
  ResolvedRulesStack,
  RulesStackKindIndex,
  RulesStackRecordEntry,
  RulesStackRecordSource,
} from './rules/stack.js';
export { lookupRulesRecord } from './rules/lookup.js';
export type { RulesLookupInput, RulesLookupResult } from './rules/lookup.js';
export type { RulesRecord, RulesRecordKind } from './rules/types.js';

// SRD raw catalog data and lookup index.
export { SRD_CATALOG, SRD_LICENSE } from './srd/data.js';
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

// Character-creation low-level helpers + Pathfinder-specific draft validator
// (the high-level `completeCharacterCreation` is the stable entrypoint).
export {
  buildCharacterCreationMutations,
  validateCharacterDraft,
} from './characterCreation.js';
export type { CharacterCreationMutationMetadata } from './characterCreation.js';
export {
  PathfinderCharacterCreationError,
  validatePathfinderCharacterDraft,
} from './character/pathfinder2e.js';
export type {
  CreatedPathfinderCharacter,
  PathfinderCharacterCreationResult,
  PathfinderCharacterDraft,
} from './character/pathfinder2e.js';
