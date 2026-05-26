/**
 * Deterministic tool layer (E5). Tools are the only path the DM model has to
 * dice math and canon writes: narration is free, but anything mechanical goes
 * through a tool. Every tool returns a structured `ToolResult` — never throws
 * across the seam — so the orchestrator can feed errors back to the model and
 * keep the turn recoverable.
 *
 * This module assembles the default tool set from focused per-tool modules.
 * The provider-neutral registry contract lives in `toolRegistry.ts`.
 */

export type { Tool, ToolContext, ToolResult } from './toolRegistry.js';
export { ToolRegistry } from './toolRegistry.js';

export type { MarkSceneToolData } from './toolMarkScene.js';
export { isMarkSceneToolData } from './toolMarkScene.js';

import { lookupRulesTool } from './toolLookupRules.js';
import { markSceneTool } from './toolMarkScene.js';
import { memoryDrilldownTool } from './toolMemoryDrilldown.js';
import { mutateStateTool } from './toolMutateState.js';
import type { Tool } from './toolRegistry.js';
import { ToolRegistry } from './toolRegistry.js';
import { rollTool } from './toolRoll.js';
import { worldQueryTool } from './toolWorldQuery.js';

export const DEFAULT_TOOLS: readonly Tool[] = [
  rollTool,
  markSceneTool,
  lookupRulesTool,
  mutateStateTool,
  worldQueryTool,
  memoryDrilldownTool,
];

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of DEFAULT_TOOLS) {
    registry.register(tool);
  }
  return registry;
}
