import type { ModelToolDefinition } from './toolSchema.js';

/**
 * Hint to the provider about the expected response shape. `text` is the
 * default; `json` asks the provider for a JSON-shaped response when its API
 * supports a structured-output mode (e.g. Anthropic / OpenAI JSON modes).
 * Adapters that have no such mode SHOULD ignore the hint rather than fail.
 */
export type ModelResponseFormat = 'text' | 'json';

/**
 * Provider-neutral profile metadata threaded through the call site
 * (eshyra-0jq.11). Adapters may use this for routing, logging, or
 * rate-limit shaping. Never contains provider-specific identifiers.
 */
export interface ModelProfileMetadata {
  /** Profile name from `MODEL_PROFILES`. */
  readonly profile: string;
  /** Quality tier ("premium", "standard", "auxiliary", "experimental"). */
  readonly tier?: string;
  /** Whether this call is permitted to drive canon-changing operations. */
  readonly canonChanging?: boolean;
}

/**
 * Trace metadata an adapter may forward to provider-side logs or its own
 * tracing channel. Free-form by design so callers can add keys without
 * churning the contract; the core never inspects `extra`.
 */
export interface ModelTraceMetadata {
  readonly campaignId?: string;
  readonly sessionId?: string;
  readonly turnId?: string;
  /** Free-form extra fields (e.g. experiment id, ramp bucket). */
  readonly extra?: Readonly<Record<string, string>>;
}

/**
 * Structured input to a single ModelClient call. Adapters MAY flatten the
 * structured fields back into a single prompt string internally — the
 * Agent SDK adapter still does — but the contract preserves the structure so
 * future adapters can render native messages, native tool calls, and per-call
 * routing/trace metadata without changing core call sites.
 */
export interface ModelCompleteInput {
  system?: string;
  messages: readonly ModelMessage[];
  /**
   * Provider-neutral tool definitions the model may invoke (eshyra-0jq.10).
   * The fenced-text tool-call protocol does not consult this list — it's the
   * seam for adapters that target native provider tool channels.
   */
  tools?: readonly ModelToolDefinition[];
  responseFormat?: ModelResponseFormat;
  profile?: ModelProfileMetadata;
  trace?: ModelTraceMetadata;
}

/**
 * A structured tool call returned by a provider that supports a native
 * tool-use channel. Adapters that flatten to text leave this absent;
 * orchestrators that already parse fenced `tool_call` blocks out of
 * {@link ModelCompleteResult.text} keep working unchanged.
 */
export interface ModelToolCall {
  /**
   * Provider-assigned id, when available. Used by adapters to correlate a
   * subsequent `tool_result` message with the call.
   */
  readonly id?: string;
  /** Tool name (must match a registered {@link ModelToolDefinition.name}). */
  readonly name: string;
  /** Parsed JSON arguments. */
  readonly args: unknown;
}

/**
 * Provider-neutral result for a native tool call. Adapters render this into
 * their provider's required history shape (for example, Anthropic
 * `tool_result` blocks or OpenAI `tool` messages).
 */
export interface ModelToolResult {
  /** Provider-assigned id copied from the corresponding tool call. */
  readonly callId?: string;
  /** Tool name, retained for providers and traces that use name correlation. */
  readonly name: string;
  /** Deterministic Eshyra tool outcome. */
  readonly result:
    | { readonly ok: true; readonly data: unknown }
    | {
        readonly ok: false;
        readonly code: string;
        readonly message: string;
      };
}

/**
 * Normalized reason the model stopped. Adapters map provider-specific values:
 *  - `end_turn`: model is done; `text` holds the final response.
 *  - `tool_use`: model emitted structured `toolCalls` and is awaiting results.
 *  - `max_tokens`: response was truncated.
 *  - `other`: anything not covered above (adapter-specific).
 *
 * Optional — adapters that can't distinguish stop reasons leave it unset.
 */
export type ModelStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'other';

/**
 * Provider-neutral conversation message. Plain-text adapters use `content`
 * only. Native-tool adapters also render `toolCalls` on assistant messages and
 * `toolResults` on user messages into the provider-specific wire format.
 */
export interface ModelMessage {
  role: 'user' | 'assistant';
  content: string;
  readonly toolCalls?: readonly ModelToolCall[];
  readonly toolResults?: readonly ModelToolResult[];
  readonly stopReason?: ModelStopReason;
}

/**
 * Structured result of a ModelClient call (eshyra-0jq.11). `text` is
 * always populated (possibly empty) so callers that only care about narration
 * can ignore the structured fields entirely. Native tool calls are normalized
 * by the orchestrator into the same deterministic execution path as fenced
 * `tool_call` blocks. A `tool_use` stop reason without consumable calls is a
 * provider-contract error and fails the turn loudly.
 */
export interface ModelCompleteResult {
  /** Free-text assistant response. Always present, possibly empty. */
  readonly text: string;
  /** Native structured tool calls, when the provider returns them. */
  readonly toolCalls?: readonly ModelToolCall[];
  /** Best-effort normalized stop reason. */
  readonly stopReason?: ModelStopReason;
}

/**
 * Raised by a ModelClient when the underlying provider fails to produce a
 * completion — a provider/SDK error, or a response stream that ends without a
 * result message.
 *
 * Error-path contract (decided in loreweaver-jmv): `complete` MUST reject with
 * a ModelClientError on provider failure rather than resolving with an empty
 * result. A silently-empty resolution is indistinguishable from a legitimately
 * empty completion and surfaces downstream as blank narration; a typed throw
 * lets callers — notably the atomic Orchestrator turn loop, which is
 * SAVEPOINT-wrapped — fail loudly and leave pre-turn state intact. A typed
 * Result return was rejected as the heavier option: it would ripple a
 * discriminated union through every caller and type for a path that is always
 * fatal to the turn anyway.
 *
 * This is distinct from a *successful* completion whose text happens to be
 * empty — that still resolves normally; judging an empty-but-successful
 * narration is the caller's concern, not the client's.
 */
export class ModelClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelClientError';
  }
}

export interface ModelClient {
  /**
   * Resolve with a structured completion result for the given input.
   *
   * @throws {ModelClientError} if the provider errors or the response stream
   * ends without a result. Implementations MUST NOT swallow provider failures
   * into an empty-text return.
   */
  complete(input: ModelCompleteInput): Promise<ModelCompleteResult>;
}
