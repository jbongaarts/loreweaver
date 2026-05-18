import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk';
import type { ModelClient, ModelCompleteInput } from './client.js';

/**
 * The ONLY file permitted to import the Claude Agent SDK. If the installed SDK's
 * surface differs from the assumptions below, adapt ONLY this file — the
 * ModelClient contract and all unit tests stay unchanged.
 *
 * Verified against @anthropic-ai/claude-agent-sdk@0.3.143:
 * - `query()` returns `Query extends AsyncGenerator<SDKMessage, void>`
 * - `SDKResultSuccess` has `type: 'result'`, `subtype: 'success'`, and `result: string`
 * - `SDKResultError` has `type: 'result'` and a non-'success' `subtype` (e.g. 'error_during_execution')
 * - Extraction narrows to `SDKResultSuccess` by checking `type === 'result'` AND
 *   `subtype === 'success'`, which correctly excludes SDKResultError.
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
      if (message.type === 'result' && message.subtype === 'success') {
        const m = message as SDKResultSuccess;
        out = m.result;
      }
    }
    return out;
  }
}
