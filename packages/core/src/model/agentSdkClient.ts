import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk';
import type { ModelClient, ModelCompleteInput } from './client.js';
import { ModelClientError } from './client.js';

/**
 * Explicit provider-auth seam for the Agent SDK adapter (loreweaver-lus).
 *
 * By default the Agent SDK inherits ambient `process.env` auth — the local-dev
 * path, where `ANTHROPIC_API_KEY` is exported in the shell. Hosted BYOK and
 * other deployments instead hand each client its own provider secret through
 * an {@link AgentSdkAuthSource}, so authentication never depends on ambient
 * process state.
 *
 * The secret is used ONLY to authenticate the SDK call. It is held in an
 * ECMAScript-private (`#`) field — invisible to `JSON.stringify`, `Object.keys`,
 * and structured-clone — and is forwarded ONLY through the SDK process
 * environment. It is never folded into the prompt, the model id, trace
 * records, logs, tool payloads, or any persisted campaign data.
 */
export interface AgentSdkAuth {
  /**
   * Environment variables injected into the Agent SDK process for the call,
   * e.g. `{ ANTHROPIC_API_KEY: '...' }`. Merged over the inherited
   * `process.env`, so unrelated variables (PATH, HOME, ...) are preserved.
   */
  env: Record<string, string>;
}

/**
 * An auth source: either a fixed {@link AgentSdkAuth}, or a function resolved
 * on every `complete()` call. The function form supports per-request secrets
 * and short-lived / rotating credentials without rebuilding the client.
 */
export type AgentSdkAuthSource = AgentSdkAuth | (() => AgentSdkAuth);

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
 * - `options.env` overrides the environment of the spawned SDK process (it
 *   otherwise defaults to `process.env`); this is the BYOK auth-injection seam.
 *
 * Error path (loreweaver-jmv): a provider failure must surface as a thrown
 * `ModelClientError`, never a silent empty-string return — see ModelClient.
 */
export class AgentSdkModelClient implements ModelClient {
  // ECMAScript-private (`#`) so an accidentally serialized client — e.g. one
  // captured into a turn trace or a log line — cannot leak the auth source.
  // TypeScript's `private` keyword would still leave an enumerable own property.
  readonly #model: string;
  readonly #auth: AgentSdkAuthSource | undefined;

  /**
   * @param model Provider-specific model id.
   * @param auth  Optional explicit provider-auth source. When omitted, the SDK
   *              falls back to ambient `process.env` auth (the local-dev path).
   */
  constructor(model: string, auth?: AgentSdkAuthSource) {
    this.#model = model;
    this.#auth = auth;
  }

  async complete(input: ModelCompleteInput): Promise<string> {
    const prompt = input.messages
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');
    const auth = this.#resolveAuth();
    let result: string | undefined;
    let errorSubtype: string | undefined;
    for await (const message of query({
      prompt,
      options: {
        model: this.#model,
        ...(input.system ? { systemPrompt: input.system } : {}),
        // Auth env is merged OVER process.env so the SDK subprocess keeps its
        // inherited environment (PATH, ...) while the explicit secret wins.
        // Omitted entirely when no auth source is set, so the SDK keeps its
        // default ambient-`process.env` behaviour.
        ...(auth ? { env: { ...process.env, ...auth.env } } : {}),
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

  /**
   * Resolve the auth source for this call. `undefined` means no explicit auth
   * was configured, so the SDK uses ambient `process.env` auth.
   */
  #resolveAuth(): AgentSdkAuth | undefined {
    if (this.#auth === undefined) {
      return undefined;
    }
    return typeof this.#auth === 'function' ? this.#auth() : this.#auth;
  }
}
