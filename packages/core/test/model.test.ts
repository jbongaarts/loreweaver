import { describe, expect, it } from 'vitest';
import type {
  ModelClient,
  ModelCompleteResult,
  ModelMessage,
  ModelToolDefinition,
} from '../src/internal.js';

class FakeModelClient implements ModelClient {
  readonly seen: Array<{
    system?: string;
    messages: readonly ModelMessage[];
    tools?: readonly ModelToolDefinition[];
    responseFormat?: string;
    profile?: { profile: string; tier?: string; canonChanging?: boolean };
    trace?: { turnId?: string };
  }> = [];

  async complete(input: {
    system?: string;
    messages: readonly ModelMessage[];
    tools?: readonly ModelToolDefinition[];
    responseFormat?: 'text' | 'json';
    profile?: { profile: string; tier?: string; canonChanging?: boolean };
    trace?: { turnId?: string };
  }): Promise<ModelCompleteResult> {
    this.seen.push(input);
    const last = input.messages.at(-1)?.content ?? '';
    return { text: `echo:${last}`, stopReason: 'end_turn' };
  }
}

describe('ModelClient contract', () => {
  it('a conforming client returns assistant text for the last message', async () => {
    const client: ModelClient = new FakeModelClient();
    const out = await client.complete({
      system: 'be terse',
      messages: [{ role: 'user', content: 'ping' }],
    });
    expect(out.text).toBe('echo:ping');
    expect(out.stopReason).toBe('end_turn');
  });

  it('carries optional tools, responseFormat, profile, and trace through to the adapter (eshyra-0jq.11)', async () => {
    const fake = new FakeModelClient();
    const client: ModelClient = fake;
    const rollSchema: ModelToolDefinition = {
      name: 'roll',
      description: 'Roll dice.',
      inputSchema: {
        type: 'object',
        properties: { dice: { type: 'string' } },
        required: ['dice'],
        additionalProperties: false,
      },
    };

    await client.complete({
      system: 'be a DM',
      messages: [{ role: 'user', content: 'go' }],
      tools: [rollSchema],
      responseFormat: 'text',
      profile: { profile: 'premium_dm', tier: 'premium', canonChanging: true },
      trace: { turnId: 'turn-1' },
    });

    expect(fake.seen).toHaveLength(1);
    const seen = fake.seen[0];
    // Every structured field is preserved verbatim — the adapter is free to
    // ignore them, but it MUST receive them.
    expect(seen.tools).toEqual([rollSchema]);
    expect(seen.responseFormat).toBe('text');
    expect(seen.profile).toEqual({
      profile: 'premium_dm',
      tier: 'premium',
      canonChanging: true,
    });
    expect(seen.trace).toEqual({ turnId: 'turn-1' });
  });

  it('carries native tool calls and correlated results through message history', async () => {
    const fake = new FakeModelClient();

    await fake.complete({
      messages: [
        { role: 'user', content: 'open the door' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call_123',
              name: 'roll',
              args: { dice: '1d20' },
            },
          ],
          stopReason: 'tool_use',
        },
        {
          role: 'user',
          content: 'Tool results are attached.',
          toolResults: [
            {
              callId: 'call_123',
              name: 'roll',
              result: { ok: true, data: { total: 17 } },
            },
          ],
        },
      ],
    });

    expect(fake.seen[0].messages).toMatchObject([
      { role: 'user', content: 'open the door' },
      {
        role: 'assistant',
        toolCalls: [{ id: 'call_123', name: 'roll' }],
        stopReason: 'tool_use',
      },
      {
        role: 'user',
        toolResults: [
          {
            callId: 'call_123',
            name: 'roll',
            result: { ok: true, data: { total: 17 } },
          },
        ],
      },
    ]);
  });
});
