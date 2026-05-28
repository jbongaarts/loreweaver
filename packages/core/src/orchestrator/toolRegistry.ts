/**
 * Core tool contract types, shared helpers, and the ToolRegistry class.
 * Individual tools live in their own modules; this module is the provider-neutral seam.
 */

import type {
  ModelToolDefinition,
  ToolInputSchema,
} from '../model/toolSchema.js';
import {
  CharacterResolutionError,
  resolveCharacterRef,
} from '../state/activeCharacter.js';

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; code: string; message: string };

export interface ToolContext {
  db: import('../persistence/db.js').Db;
  rng: import('./rng.js').Rng;
  campaignId: string;
  sessionId: string;
  turnId: string;
  /** ISO timestamp stamped on every write this turn. */
  at: string;
  /**
   * The party member acting on this turn. Character-scoped tools target this
   * PC by default; when undefined they fall back to the active character
   * (`meta.active_character_id`). An explicit per-call `character` argument
   * (where a tool supports one) overrides both.
   */
  actingCharacterId?: string;
}

export interface Tool {
  readonly name: string;
  readonly description: string;
  /**
   * Provider-neutral input schema (loreweaver-0jq.10). Lifted straight into
   * {@link ToolRegistry.definitions} so adapters can render native tool calls;
   * the fenced-text protocol does not consult it. Tool authors are still
   * responsible for runtime validation in `run` — the schema is documentation
   * and a contract surface, not an enforcement seam.
   */
  readonly inputSchema: ToolInputSchema;
  run(args: unknown, ctx: ToolContext): ToolResult;
}

export function ok(data: unknown): ToolResult {
  return { ok: true, data };
}

export function err(code: string, message: string): ToolResult {
  return { ok: false, code, message };
}

export function asRecord(args: unknown): Record<string, unknown> | undefined {
  return typeof args === 'object' && args !== null && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : undefined;
}

/** Shared JSON-schema fragment for the optional `character` targeting arg. */
export const CHARACTER_TARGET_SCHEMA = {
  type: 'string',
  description:
    'Party member to target by id or name. Defaults to the acting character.',
  minLength: 1,
} as const;

/**
 * Resolve an optional `character` tool argument to a target character id.
 * Returns `{ id }` (where `id` is undefined to mean "the acting/active PC")
 * on success, or an error `ToolResult` when the ref is malformed, unknown, or
 * ambiguous so the tool can hand the correction back to the model.
 */
export function resolveTargetCharacterId(
  character: unknown,
  ctx: ToolContext,
): { id: string | undefined } | ToolResult {
  if (character === undefined || character === null) {
    return { id: ctx.actingCharacterId };
  }
  if (typeof character !== 'string' || character.length === 0) {
    return err(
      'invalid_args',
      'character must be a non-empty string id or name',
    );
  }
  try {
    return { id: resolveCharacterRef(ctx.db, character) };
  } catch (e) {
    if (e instanceof CharacterResolutionError) {
      return err('invalid_target', e.message);
    }
    throw e;
  }
}

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

  /**
   * Provider-neutral tool definitions in registration order. Each entry has the
   * (name, description, inputSchema) triple a ModelClient adapter needs to
   * render native tool calls — no provider-specific keys leak through.
   */
  definitions(): readonly ModelToolDefinition[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
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
