export interface ModelMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ModelCompleteInput {
  system?: string;
  messages: ModelMessage[];
}

/**
 * Raised by a ModelClient when the underlying provider fails to produce a
 * completion — a provider/SDK error, or a response stream that ends without a
 * result message.
 *
 * Error-path contract (decided in loreweaver-jmv): `complete` MUST reject with
 * a ModelClientError on provider failure rather than resolving with an empty
 * string. A silently-empty resolution is indistinguishable from a legitimately
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
   * Resolve with the assistant's completion text for the given input.
   *
   * @throws {ModelClientError} if the provider errors or the response stream
   * ends without a result. Implementations MUST NOT swallow provider failures
   * into an empty-string return.
   */
  complete(input: ModelCompleteInput): Promise<string>;
}
