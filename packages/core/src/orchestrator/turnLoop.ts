import type { ModelClient, ModelMessage } from '../model/client.js';
import { parseToolCalls, renderToolResults } from './protocol.js';
import type { ToolContext, ToolRegistry, ToolResult } from './tools.js';

export interface RunModelLoopTrace {
  readonly campaignId?: string;
  readonly sessionId?: string;
  readonly turnId?: string;
}

/**
 * Model/tool round loop (E5).
 *
 * One "loop" is the inner mechanic of a turn: hand the model an initial user
 * message, parse any tool_call blocks it emits, execute them against the
 * deterministic tool layer, and feed the structured tool_result back. The
 * loop terminates when the model replies with no tool_call (that reply is the
 * final narration) or when the round budget is exhausted.
 *
 * The loop does not own a transaction. Tool invocations mutate canon as they
 * run; the caller wraps the loop in a SAVEPOINT so a mid-loop failure rolls
 * back every accepted mutation. The loop throws `OrchestratorError` for the
 * two protocol-level failure modes (rounds exhausted, empty narration) and
 * lets any other exception (model SDK failure, tool exception) propagate
 * unchanged.
 */

export class OrchestratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrchestratorError';
  }
}

export interface ExecutedToolCall {
  tool: string;
  args: unknown;
  result: ToolResult;
}

export interface RunModelLoopInput {
  model: ModelClient;
  registry: ToolRegistry;
  toolCtx: ToolContext;
  system: string;
  /** Initial user message that opens the conversation (assembled context). */
  initialUserMessage: string;
  /** Hard cap on model rounds before the turn is judged stuck. */
  maxToolRounds: number;
  /**
   * Invoked at the start of each round, before the model is called. The
   * caller uses this to track in-flight round count for reporting on both
   * the success and failure paths.
   */
  onRoundStart?: () => void;
  /**
   * Optional trace metadata forwarded to the ModelClient on every round
   * (eshyra-0jq.11). Adapters that can route trace info to provider-side
   * logs will use it; others ignore it.
   */
  trace?: RunModelLoopTrace;
}

export interface RunModelLoopResult {
  narration: string;
  toolCalls: ExecutedToolCall[];
  rounds: number;
}

export async function runModelLoop(
  input: RunModelLoopInput,
): Promise<RunModelLoopResult> {
  const {
    model,
    registry,
    toolCtx,
    system,
    initialUserMessage,
    maxToolRounds,
    onRoundStart,
    trace,
  } = input;

  const messages: ModelMessage[] = [
    { role: 'user', content: initialUserMessage },
  ];
  const toolCalls: ExecutedToolCall[] = [];
  const tools = registry.definitions();
  let rounds = 0;
  let narration: string | undefined;

  while (rounds < maxToolRounds) {
    rounds += 1;
    onRoundStart?.();
    const result = await model.complete({
      system,
      messages,
      // Provider-neutral tool definitions (eshyra-0jq.10) — adapters with
      // a native tool channel may use them; the fenced-text protocol below
      // does not consult them and is unchanged.
      tools,
      ...(trace ? { trace } : {}),
    });
    const modelText = result.text;
    const calls = parseToolCalls(modelText);
    if (calls.length === 0) {
      narration = modelText.trim();
      break;
    }

    const roundResults: Array<{ tool: string; result: ToolResult }> = [];
    for (const call of calls) {
      if (call.ok) {
        const result = registry.invoke(call.tool, call.args, toolCtx);
        toolCalls.push({ tool: call.tool, args: call.args, result });
        roundResults.push({ tool: call.tool, result });
      } else {
        const result: ToolResult = {
          ok: false,
          code: 'parse_error',
          message: call.error,
        };
        toolCalls.push({ tool: 'unknown', args: call.raw, result });
        roundResults.push({ tool: 'unknown', result });
      }
    }
    messages.push({ role: 'assistant', content: modelText });
    messages.push({ role: 'user', content: renderToolResults(roundResults) });
  }

  if (narration === undefined) {
    throw new OrchestratorError(
      `turn exceeded ${maxToolRounds} tool rounds without final narration`,
    );
  }
  if (narration.length === 0) {
    throw new OrchestratorError('model returned empty narration');
  }
  return { narration, toolCalls, rounds };
}
