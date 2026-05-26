import { memoryDrilldown } from '../memory/summary.js';
import type { MemoryDrilldownSelector } from '../memory/summary.js';
import type { Db } from '../persistence/db.js';
import {
  DEFAULT_DND5E_SRD_BINDING,
  readCampaignRulesBinding,
} from '../rules/binding.js';
import type { CampaignRulesBinding } from '../rules/binding.js';
import { DND5E_SRD_RULES_PACK } from '../rules/dnd5eSrd.js';
import { lookupRulesRecord } from '../rules/lookup.js';
import { PATHFINDER2E_REMASTER_RULES_PACK } from '../rules/pathfinder2eRemaster.js';
import { resolveRulesStack } from '../rules/stack.js';
import type { RulesPack, RulesRecordKind } from '../rules/types.js';
import { RulesPackError } from '../rules/types.js';
import { MutateStateError, mutateState } from '../state/mutateState.js';
import type {
  MutateStateTarget,
  MutateStateValue,
} from '../state/mutateState.js';
import type { WorldQueryTarget } from '../world/types.js';
import { worldQuery } from '../world/worldQuery.js';
import { DiceError, rollDice } from './dice.js';
import type { Rng } from './rng.js';
import { SceneError, closeScene, getOpenScene, openScene } from './scene.js';
import type { SceneRecord } from './scene.js';

/**
 * Deterministic tool layer (E5). Tools are the only path the DM model has to
 * dice math and canon writes: narration is free, but anything mechanical goes
 * through a tool. Every tool returns a structured `ToolResult` — never throws
 * across the seam — so the orchestrator can feed errors back to the model and
 * keep the turn recoverable.
 */

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; code: string; message: string };

export interface ToolContext {
  db: Db;
  rng: Rng;
  campaignId: string;
  sessionId: string;
  turnId: string;
  /** ISO timestamp stamped on every write this turn. */
  at: string;
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  run(args: unknown, ctx: ToolContext): ToolResult;
}

export interface MarkSceneToolData {
  boundary: 'open' | 'close';
  scene: SceneRecord;
}

function ok(data: unknown): ToolResult {
  return { ok: true, data };
}

function err(code: string, message: string): ToolResult {
  return { ok: false, code, message };
}

function asRecord(args: unknown): Record<string, unknown> | undefined {
  return typeof args === 'object' && args !== null && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : undefined;
}

export function isMarkSceneToolData(data: unknown): data is MarkSceneToolData {
  const record = asRecord(data);
  if (
    record === undefined ||
    (record.boundary !== 'open' && record.boundary !== 'close')
  ) {
    return false;
  }
  const scene = asRecord(record.scene);
  return typeof scene?.sceneId === 'string';
}

const rollTool: Tool = {
  name: 'roll',
  description:
    'Roll dice with code-owned RNG. args: { dice: "NdM+K", reason: string }.',
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.dice !== 'string' ||
      typeof a.reason !== 'string' ||
      a.reason.length === 0
    ) {
      return err(
        'invalid_args',
        'roll requires { dice: string, reason: string }',
      );
    }
    try {
      const roll = rollDice(a.dice, ctx.rng);
      return ok({
        dice: a.dice,
        reason: a.reason,
        rolls: roll.rolls,
        modifier: roll.modifier,
        total: roll.total,
      });
    } catch (e) {
      if (e instanceof DiceError) {
        return err('invalid_dice', e.message);
      }
      throw e;
    }
  },
};

const markSceneTool: Tool = {
  name: 'mark_scene',
  description:
    'Open or close a scene. args: { boundary: "open" | "close", title?: string }.',
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || (a.boundary !== 'open' && a.boundary !== 'close')) {
      return err(
        'invalid_args',
        'mark_scene requires { boundary: "open" | "close" }',
      );
    }
    try {
      if (a.boundary === 'open') {
        if (typeof a.title !== 'string' || a.title.length === 0) {
          return err('invalid_args', 'mark_scene open requires a title');
        }
        const scene = openScene(ctx.db, {
          campaignId: ctx.campaignId,
          sessionId: ctx.sessionId,
          sceneId: `scene-${ctx.turnId}`,
          title: a.title,
          at: ctx.at,
        });
        return ok({ boundary: 'open', scene } satisfies MarkSceneToolData);
      }
      const open = getOpenScene(ctx.db, ctx);
      if (open === undefined) {
        return err('no_open_scene', 'no open scene to close');
      }
      const scene = closeScene(ctx.db, {
        campaignId: ctx.campaignId,
        sessionId: ctx.sessionId,
        sceneId: open.sceneId,
        at: ctx.at,
      });
      return ok({ boundary: 'close', scene } satisfies MarkSceneToolData);
    } catch (e) {
      if (e instanceof SceneError) {
        return err('scene_error', e.message);
      }
      throw e;
    }
  },
};

const BUNDLED_RULES_PACKS: readonly RulesPack[] = [
  DND5E_SRD_RULES_PACK,
  PATHFINDER2E_REMASTER_RULES_PACK,
];

function findBundledPackById(packId: string): RulesPack | undefined {
  return BUNDLED_RULES_PACKS.find((pack) => pack.meta.packId === packId);
}

function findBundledBaseBySystemId(systemId: string): RulesPack | undefined {
  return BUNDLED_RULES_PACKS.find(
    (pack) => pack.meta.systemId === systemId && pack.meta.role === 'base',
  );
}

const lookupRulesTool: Tool = {
  name: 'lookup_rules',
  description:
    'Look up a rules record (creature, spell, class, ancestry, feat, ' +
    'equipment, etc.) by exact name or ref through the campaign rules ' +
    'binding. args: { kind, name?: string, ref?: string, systemId?: string }. ' +
    'Omit systemId to use the campaign binding; pass it to query a specific ' +
    'bundled rules system (e.g. "dnd5e-srd", "pathfinder2e-remaster").',
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.kind !== 'string' ||
      (typeof a.name !== 'string' && typeof a.ref !== 'string')
    ) {
      return err(
        'invalid_args',
        'lookup_rules requires { kind, name } or { kind, ref }',
      );
    }
    if (a.systemId !== undefined && typeof a.systemId !== 'string') {
      return err('invalid_args', 'lookup_rules systemId must be a string');
    }
    const kind = a.kind as RulesRecordKind;

    const basePack =
      a.systemId !== undefined
        ? findBundledBaseBySystemId(a.systemId)
        : resolveBindingBasePack(ctx);

    if (basePack === undefined) {
      const detail =
        a.systemId !== undefined
          ? `systemId '${a.systemId}' is not a bundled rules system`
          : 'campaign rules binding references a pack that is not bundled in core';
      return err('unknown_pack', `lookup_rules: ${detail}`);
    }

    try {
      const stack = resolveRulesStack({ base: basePack });
      const result =
        typeof a.ref === 'string'
          ? lookupRulesRecord(stack, { kind, ref: a.ref })
          : lookupRulesRecord(stack, { kind, name: a.name as string });

      if (result.ok) {
        return ok({
          record: result.record,
          sourcePack: result.pack,
          license: result.license,
          overrideChain: result.overrideChain,
        });
      }
      return err(result.code, result.message);
    } catch (e) {
      if (e instanceof RulesPackError) {
        return err('rules_pack_error', e.message);
      }
      throw e;
    }
  },
};

function resolveBindingBasePack(ctx: ToolContext): RulesPack | undefined {
  const binding: CampaignRulesBinding =
    readCampaignRulesBinding(ctx.db) ?? DEFAULT_DND5E_SRD_BINDING;
  return findBundledPackById(binding.base.packId);
}

const mutateStateTool: Tool = {
  name: 'mutate_state',
  description:
    'Write canonical game state. args: { target, id?, field, op: "set", value }.',
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.target !== 'string' ||
      typeof a.field !== 'string' ||
      a.op !== 'set'
    ) {
      return err(
        'invalid_args',
        'mutate_state requires { target, field, op: "set", value }',
      );
    }
    try {
      mutateState(ctx.db, {
        target: a.target as MutateStateTarget,
        id: typeof a.id === 'string' ? a.id : undefined,
        field: a.field,
        op: 'set',
        value: a.value as MutateStateValue,
        provenance: `model:${ctx.turnId}`,
        sessionId: ctx.sessionId,
        at: ctx.at,
      });
      return ok({
        applied: true,
        target: a.target,
        field: a.field,
        id: typeof a.id === 'string' ? a.id : undefined,
      });
    } catch (e) {
      if (e instanceof MutateStateError) {
        return err('mutate_error', e.message);
      }
      throw e;
    }
  },
};

const worldQueryTool: Tool = {
  name: 'world_query',
  description:
    'Resolve a world target (template + live overlay). ' +
    'args: { type: "location"|"encounter"|"npc"|"lore"|"meta", id?: string }.',
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.type !== 'string') {
      return err('invalid_args', 'world_query requires { type, id? }');
    }
    const result = worldQuery(ctx.db, a as unknown as WorldQueryTarget);
    if (result.ok) {
      return ok(result);
    }
    return err(result.code, result.message);
  },
};

const memoryDrilldownTool: Tool = {
  name: 'memory_drilldown',
  description:
    'Drill into an omitted scene_log window or older scene/session/arc ' +
    'summary excluded from the bounded prompt. args: a MemoryDrilldownSelector.',
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.target !== 'string') {
      return err('invalid_args', 'memory_drilldown requires a selector');
    }
    const result = memoryDrilldown(
      ctx.db,
      a as unknown as MemoryDrilldownSelector,
    );
    if (result === undefined) {
      return err('not_found', 'no memory record for that selector');
    }
    return ok(result);
  },
};

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): string[] {
    return [...this.tools.keys()];
  }

  invoke(name: string, args: unknown, ctx: ToolContext): ToolResult {
    const tool = this.tools.get(name);
    if (tool === undefined) {
      return err('unknown_tool', `unknown tool: ${name}`);
    }
    try {
      return tool.run(args, ctx);
    } catch (e) {
      return err('tool_error', e instanceof Error ? e.message : String(e));
    }
  }
}

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
