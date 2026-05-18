import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ModelClient, ModelCompleteInput } from './client.js';

/**
 * The ONLY file permitted to import the Claude Agent SDK. If the installed SDK's
 * surface differs from the assumptions below, adapt ONLY this file — the
 * ModelClient contract and all unit tests stay unchanged.
 *
 * Assumption: `query({ prompt, options })` returns an async iterable of messages;
 * assistant text arrives on messages of type 'assistant' / 'result'. Verify against
 * the installed package's exported types before implementing; adjust extraction
 * accordingly.
 *
 * Verified against @anthropic-ai/claude-agent-sdk@0.3.143:
 * - `query()` returns `Query extends AsyncGenerator<SDKMessage, void>`
 * - `SDKResultSuccess` has `type: 'result'`, `subtype: 'success'`, and `result: string`
 * - `SDKResultError` has `type: 'result'` and `is_error: true` (no `result` field)
 * - Extraction checks `m.type === 'result' && typeof m.result === 'string'` which
 *   matches SDKResultSuccess and safely ignores SDKResultError (no result field).
 */
export class AgentSdkModelClient implements ModelClient {
  constructor(private readonly model: string) {}

  async complete(input: ModelCompleteInput): Promise<string> {
    const prompt = input.messages.map((m) => `${m.role}: ${m.content}`).join('\n');
    let out = '';
    for await (const message of query({
      prompt,
      options: {
        model: this.model,
        ...(input.system ? { systemPrompt: input.system } : {}),
      },
    })) {
      const m = message as { type?: string; result?: string };
      if (m.type === 'result' && typeof m.result === 'string') {
        out = m.result;
      }
    }
    return out;
  }
}
