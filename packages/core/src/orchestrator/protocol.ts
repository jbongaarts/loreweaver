import type { ToolRegistry, ToolResult } from './tools.js';

/**
 * DM system prompt and the text-channel tool-call protocol (E5).
 *
 * The ModelClient contract is text-in / text-out — there is no native
 * tool-use channel — so tool calls ride the text channel. The model emits
 * fenced ```tool_call blocks; the orchestrator parses them, executes the
 * deterministic tool layer, and feeds ```tool_result blocks back. When the
 * model replies with no tool_call block, that reply is the final narration.
 */

const TOOL_CALL_FENCE = /```tool_call\s*\n([\s\S]*?)\n?```/g;

export type ParsedToolCall =
  | { ok: true; tool: string; args: unknown }
  | { ok: false; error: string; raw: string };

/**
 * Extract every tool call from a model reply, in document order. Malformed
 * blocks are returned as `ok: false` entries (never thrown) so the orchestrator
 * can feed the parse error back to the model as a tool_result.
 */
export function parseToolCalls(modelText: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];
  for (const match of modelText.matchAll(TOOL_CALL_FENCE)) {
    const raw = match[1].trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      calls.push({
        ok: false,
        error: `malformed tool_call JSON: ${
          e instanceof Error ? e.message : String(e)
        }`,
        raw,
      });
      continue;
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { tool?: unknown }).tool !== 'string'
    ) {
      calls.push({
        ok: false,
        error: 'tool_call must be a JSON object with a string "tool" field',
        raw,
      });
      continue;
    }
    const obj = parsed as { tool: string; args?: unknown };
    calls.push({ ok: true, tool: obj.tool, args: obj.args ?? {} });
  }
  return calls;
}

/**
 * Serialize tool results into the user-message text fed back to the model
 * before the next model call.
 */
export function renderToolResults(
  results: ReadonlyArray<{ tool: string; result: ToolResult }>,
): string {
  const blocks = results.map(({ tool, result }) => {
    const payload = result.ok
      ? { tool, ok: true, data: result.data }
      : { tool, ok: false, code: result.code, message: result.message };
    return ['```tool_result', JSON.stringify(payload), '```'].join('\n');
  });
  return [
    'Tool results follow. Continue the turn: call more tools if needed, ' +
      'otherwise reply with final narration only.',
    ...blocks,
  ].join('\n');
}

/**
 * Build the DM system prompt: persona plus the refined-Hybrid rules contract,
 * with the live tool roster and the tool-call protocol spec appended.
 */
export function buildSystemPrompt(registry: ToolRegistry): string {
  const toolLines = registry
    .list()
    .sort()
    .map((name) => {
      const tool = registry.get(name);
      return `- ${name}: ${tool?.description ?? ''}`;
    });

  return [
    'You are the Dungeon Master for a long-running solo fantasy campaign.',
    'You narrate vividly and in the second person, keep continuity with',
    'established canon, and play NPCs consistently.',
    '',
    '## The Hybrid Contract',
    '',
    'Narrate freely — prose, dialogue, description, and pacing are yours.',
    'But everything mechanical is NOT yours to assert in prose:',
    '',
    '- All dice and math go through the `roll` tool. Never invent a die result.',
    '- All changes to canonical game state (HP, inventory, plot flags, clock,',
    '  world overlay) go through the `mutate_state` tool. Prose that claims a',
    '  state change without a tool call does NOT change the game — the canon',
    '  is unchanged and the player is misled. Always call the tool.',
    '- Before running ANY creature in a scene (combat or otherwise) or invoking',
    '  any rules mechanic, call `lookup_rules` to fetch the real record from the',
    '  campaign rules system. Do not run a creature or rule from memory.',
    '- Use `world_query` to resolve locations, NPCs, and lore before narrating',
    '  them, and `memory_drilldown` to retrieve older history not in context.',
    '- Use `mark_scene` to open and close scenes at natural narrative breaks.',
    '',
    '## Available Tools',
    '',
    ...toolLines,
    '',
    '## Tool-Call Protocol',
    '',
    'To call a tool, emit a fenced block tagged `tool_call` containing a JSON',
    'object `{"tool": "<name>", "args": {...}}`. You may emit several in one',
    'reply; they run in order. Example:',
    '',
    '```tool_call',
    '{"tool": "roll", "args": {"dice": "1d20+5", "reason": "attack roll"}}',
    '```',
    '',
    'After your tool calls you will receive `tool_result` blocks. Inspect them,',
    'call more tools if needed, and when the turn is mechanically resolved,',
    'reply with ONLY the final narration prose — no tool_call block. That',
    'tool-call-free reply is the turn the player sees.',
  ].join('\n');
}
