import type { ModelToolDefinition } from './toolSchema.js';

export interface ModelMessage {
  role: 'user' | 'assistant';
  content: string;
}

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
 * Structured result of a ModelClient call (eshyra-0jq.11). `text` is
 * always populated (possibly empty) so callers that only care about narration
 * can ignore the structured fields entirely. Adapters that produce native
 * tool calls populate {@link toolCalls} / {@link stopReason}, but the
 * orchestrator runtime does NOT consume them yet: it drives tools solely
 * through the fenced-text `tool_call` protocol parsed out of `text`. To keep
 * that gap from silently dropping mechanical actions, `runModelLoop` rejects
 * any result that carries native tool calls or `stopReason: 'tool_use'` with a
 * loud `OrchestratorError`. A native-tool adapter must wait until the loop is
 * taught to consume these fields (the bead audit is eshyra-0jq.25). Until then,
 * adapters MUST leave them unset.
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
