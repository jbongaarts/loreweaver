/**
 * `@loreweaver/core` — stable public surface.
 *
 * This file is the **stable** entry point: every symbol exported below is
 * intended for use by external consumers (the CLI today; a future hosted/PWA
 * runtime tomorrow), and we will treat breaking changes here as breaking
 * changes to the whole project.
 *
 * Implementation details, scaffolding, low-level primitives, raw datasets,
 * evaluation/benchmark helpers, and anything that is expected to move as the
 * architecture evolves are intentionally **not** re-exported here. They live
 * behind the explicit `@loreweaver/core/internal` subpath. Consumers should
 * never import that subpath from production code — it carries no compatibility
 * promise. Co-developed callers inside this repository (e.g. the CLI tests)
 * may import from `/internal` when they genuinely need to assert against
 * implementation details.
 *
 * Roughly, the stable surface here covers: configuration, opening/initialising
 * the campaign database, the campaign + session + turn lifecycle, the
 * high-level memory composition/read APIs, character creation, the built-in
 * sample content and rules packs, the rules-binding read/write API, the
 * model-client contract + Agent SDK adapter, demo-mode entrypoints, and the
 * Dolt-backed checkpoint store plus managed-binary install seam.
 */

// Core version (used by the CLI banner).
export const CORE_VERSION = '0.0.0';

// Configuration.
export { ConfigError, loadConfig } from './config.js';
export type {
  LoreweaverConfig,
  ProviderAuth,
  ProviderAuthMode,
} from './config.js';
export type { ConfiguredProfileEntry } from './model/profiles.js';

// Live campaign database.
export { openDatabase } from './persistence/db.js';
export type { Db } from './persistence/db.js';
export {
  SCHEMA_VERSION,
  SchemaCompatibilityError,
  initSchema,
} from './persistence/schema.js';

// Campaign lifecycle.
export { CampaignError, createCampaign, getCampaign } from './campaign.js';
export type { CampaignInfo, CreateCampaignInput } from './campaign.js';

// Session lifecycle.
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

// Graceful session close (commits a recap + checkpoint hand-off).
export { closeSessionGracefully } from './sessionClose.js';
export type {
  CloseSessionGracefullyInput,
  CloseSessionGracefullyResult,
  SessionCheckpointRunner,
} from './sessionClose.js';

// Session launch (resume-or-new view used by the play UI).
export { getSessionLaunchState } from './sessionLaunch.js';
export type { SessionLaunchState } from './sessionLaunch.js';

// Turn orchestrator.
export { OrchestratorError, runTurn } from './orchestrator/orchestrator.js';
export type {
  ExecutedToolCall,
  RunTurnDeps,
  RunTurnInput,
  RunTurnResult,
} from './orchestrator/orchestrator.js';

// Tool registry contract — the supported plug-in seam for custom tools.
export {
  DEFAULT_TOOLS,
  ToolRegistry,
  createDefaultToolRegistry,
} from './orchestrator/tools.js';
export type { Tool, ToolContext, ToolResult } from './orchestrator/tools.js';

// Model client contract + Agent SDK adapter.
export { ModelClientError } from './model/client.js';
export type {
  ModelClient,
  ModelCompleteInput,
  ModelMessage,
} from './model/client.js';
export { AgentSdkModelClient } from './model/agentSdkClient.js';
export type {
  AgentSdkAuth,
  AgentSdkAuthSource,
} from './model/agentSdkClient.js';

// Memory: high-level composition and read APIs.
export { composeSessionRecap } from './memory/recapBuilder.js';
export type {
  ComposeSessionRecapInput,
  ComposeSessionRecapResult,
} from './memory/recapBuilder.js';
export { composeArcSummary } from './memory/arcSummary.js';
export type { ComposeArcSummaryInput } from './memory/arcSummary.js';
export { extractCampaignBible } from './memory/campaignBibleExtractor.js';
export type { ExtractCampaignBibleInput } from './memory/campaignBibleExtractor.js';
export {
  getArcSummary,
  getCampaignBible,
  getSessionRecap,
  rollupArcSummary,
} from './memory/summary.js';
export type {
  ArcSummaryInput,
  ArcSummaryKey,
  ArcSummaryRecord,
  CampaignBibleEntry,
  CampaignBibleInput,
  CampaignBibleKey,
  CampaignBibleRecord,
  SessionRecapInput,
  SessionRecapRecord,
} from './memory/summary.js';

// Character creation (high-level, system-dispatching).
export {
  CharacterCreationError,
  completeCharacterCreation,
} from './characterCreation.js';
export type {
  AbilityScoreMethod,
  AbilityScoreName,
  AbilityScores,
  CharacterCreationDraft,
  CharacterCreationResult,
  CharacterCreationSystem,
  CompleteCharacterCreationInput,
  CompleteCharacterCreationResult,
  CreatedCharacter,
} from './characterCreation.js';

// Demo mode (entrypoints — the policy/budget helpers live in /internal).
export {
  DEFAULT_DEMO_PACK,
  DEMO_TURN_CAP,
  DemoModeError,
  createDemoCampaign,
  getDemoTurnBudget,
} from './demoMode.js';
export type {
  CreateDemoCampaignOptions,
  DemoCampaign,
  DemoContentPolicy,
  DemoModelDecision,
  DemoQualityLabel,
  DemoTurnBudget,
} from './demoMode.js';

// Built-in sample world module and module-pack shape.
export { EMBERFALL_HOLLOW } from './world/samples/emberfallHollow.js';
export type {
  ModuleMeta,
  ModulePack,
  PackLicense,
  PackLicenseClass,
  PackType,
} from './world/types.js';

// Built-in rules packs + the campaign rules-binding read/write API.
export { DND5E_SRD_RULES_PACK } from './rules/dnd5eSrd.js';
export { PATHFINDER2E_REMASTER_RULES_PACK } from './rules/pathfinder2eRemaster.js';
export {
  DEFAULT_DND5E_SRD_BINDING,
  readCampaignRulesBinding,
  writeCampaignRulesBinding,
} from './rules/binding.js';
export type {
  CampaignRulesBinding,
  CampaignRulesBindingPackRef,
} from './rules/binding.js';
export { RulesPackError } from './rules/types.js';
export type {
  CompatibleBaseSystem,
  RecordProvenance,
  RulesPack,
  RulesPackLicense,
  RulesPackLicenseClass,
  RulesPackMeta,
  RulesPackRole,
  RulesPackSource,
} from './rules/types.js';

// Dolt-backed checkpoint store + managed-binary install seam.
export {
  CheckpointError,
  CheckpointStore,
} from './persistence/checkpoint/store.js';
export { DoltRepo } from './persistence/checkpoint/doltRepo.js';
export type { Checkpoint } from './persistence/checkpoint/doltRepo.js';
export { DoltUnavailableError } from './persistence/checkpoint/doltBinary.js';
export { ensureDoltAvailable } from './persistence/checkpoint/doltProvision.js';
export type {
  DoltInstallPrompt,
  DoltInstallReason,
  EnsureDoltOptions,
} from './persistence/checkpoint/doltProvision.js';
