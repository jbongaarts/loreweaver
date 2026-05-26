/**
 * Core tool contract types, shared helpers, and the ToolRegistry class.
 * Individual tools live in their own modules; this module is the provider-neutral seam.
 */

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
}

export interface Tool {
  readonly name: string;
  readonly description: string;
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
