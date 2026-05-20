import { describe, expect, it } from 'vitest';
import {
  buildSystemPrompt,
  createDefaultToolRegistry,
  parseToolCalls,
  renderToolResults,
} from '../src/index.js';
import type { ToolResult } from '../src/index.js';

describe('DM system prompt', () => {
  it('encodes the Hybrid rules contract', () => {
    const prompt = buildSystemPrompt(createDefaultToolRegistry());
    expect(prompt.toLowerCase()).toContain('narrate');
    // All mechanics go through tools, not prose.
    expect(prompt).toMatch(/tool/i);
    // lookup_srd before running any creature.
    expect(prompt).toContain('lookup_srd');
    expect(prompt.toLowerCase()).toContain('creature');
    // state changes must go through mutate_state, not narration.
    expect(prompt).toContain('mutate_state');
  });

  it('lists the available tools and the tool-call protocol', () => {
    const prompt = buildSystemPrompt(createDefaultToolRegistry());
    for (const name of ['roll', 'mark_scene', 'lookup_srd']) {
      expect(prompt).toContain(name);
    }
    expect(prompt).toContain('tool_call');
  });
});

describe('parseToolCalls', () => {
  it('returns no calls for pure narration', () => {
    expect(parseToolCalls('The tavern is warm and loud.')).toEqual([]);
  });

  it('extracts a single tool call', () => {
    const text = [
      'I need to roll for that.',
      '```tool_call',
      '{"tool": "roll", "args": {"dice": "1d20+5", "reason": "attack"}}',
      '```',
    ].join('\n');
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].ok).toBe(true);
    if (calls[0].ok) {
      expect(calls[0].tool).toBe('roll');
      expect(calls[0].args).toEqual({ dice: '1d20+5', reason: 'attack' });
    }
  });

  it('extracts multiple tool calls in order', () => {
    const text = [
      '```tool_call',
      '{"tool": "lookup_srd", "args": {"kind": "monster", "name": "Goblin"}}',
      '```',
      'then',
      '```tool_call',
      '{"tool": "roll", "args": {"dice": "1d20", "reason": "init"}}',
      '```',
    ].join('\n');
    const calls = parseToolCalls(text);
    expect(calls.map((c) => (c.ok ? c.tool : 'ERR'))).toEqual([
      'lookup_srd',
      'roll',
    ]);
  });

  it('reports malformed JSON as a parse error rather than throwing', () => {
    const text = ['```tool_call', '{not json}', '```'].join('\n');
    const calls = parseToolCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].ok).toBe(false);
  });

  it('reports a missing tool name as a parse error', () => {
    const text = ['```tool_call', '{"args": {}}', '```'].join('\n');
    const calls = parseToolCalls(text);
    expect(calls[0].ok).toBe(false);
  });
});

describe('renderToolResults', () => {
  it('round-trips results back into a model-readable message', () => {
    const results: Array<{ tool: string; result: ToolResult }> = [
      { tool: 'roll', result: { ok: true, data: { total: 17 } } },
      {
        tool: 'mutate_state',
        result: { ok: false, code: 'mutate_error', message: 'bad field' },
      },
    ];
    const message = renderToolResults(results);
    expect(message).toContain('tool_result');
    expect(message).toContain('roll');
    expect(message).toContain('17');
    expect(message).toContain('mutate_error');
    expect(message).toContain('bad field');
  });
});
