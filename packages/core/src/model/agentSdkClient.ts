import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk';
import type { ModelClient, ModelCompleteInput } from './client.js';
import { ModelClientError } from './client.js';

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
 *
 * Error path (loreweaver-jmv): a provider failure must surface as a thrown
 * `ModelClientError`, never a silent empty-string return — see ModelClient.
 */
export class AgentSdkModelClient implements ModelClient {
  constructor(private readonly model: string) {}

  async complete(input: ModelCompleteInput): Promise<string> {
    const prompt = input.messages.map((m) => `${m.role}: ${m.content}`).join('\n');
    let result: string | undefined;
    let errorSubtype: string | undefined;
    for await (const message of query({
      prompt,
      options: {
        model: this.model,
        ...(input.system ? { systemPrompt: input.system } : {}),
      },
    })) {
      if (message.type === 'result') {
        if (message.subtype === 'success') {
          result = (message as SDKResultSuccess).result;
        } else {
          // SDKResultError: type 'result' with a non-'success' subtype.
          errorSubtype = message.subtype;
        }
      }
    }
    if (result === undefined) {
      throw new ModelClientError(
        errorSubtype !== undefined
          ? `Agent SDK returned an error result (subtype: ${errorSubtype})`
          : 'Agent SDK response ended without a result message',
      );
    }
    return result;
  }
}
