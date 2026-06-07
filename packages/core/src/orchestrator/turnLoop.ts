import type {
  ModelClient,
  ModelCompleteResult,
  ModelMessage,
} from '../model/client.js';
import { parseToolCalls, renderToolResults } from './protocol.js';
import {
  hasNativeToolRequests,
  type ToolRequest,
  type ToolRequestSource,
} from './toolRequest.js';
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
  /**
   * Transport the request arrived through (eshyra-0jq.16). Always `'fenced'`
   * today; native provider tool use (eshyra-1q5) will produce `'native'`
   * without changing this shape. Carried for tracing/debugging provenance.
   */
  source: ToolRequestSource;
}

/**
 * Collect the model-requested tool actions from a single model response as
 * transport-neutral {@link ToolRequest}s.
 *
 * The fenced-text parser is the only producer wired today. Native provider tool
 * use (eshyra-1q5) is a planned second producer of the same shape; the
 * detection lives behind {@link hasNativeToolRequests} so this is the one place
 * native consumption gets switched on. Until it is, a native tool-use response
 * is rejected loudly rather than silently dropped: treating it as final
 * narration would lose the mechanical actions the model asked for, exactly the
 * canon-integrity failure the hybrid contract exists to prevent (state changes
 * asserted without a tool call do not change the game — eshyra-0jq.25).
 */
function collectToolRequests(result: ModelCompleteResult): ToolRequest[] {
  if (hasNativeToolRequests(result)) {
    throw new OrchestratorError(
      'model returned a native tool-use response ' +
        '(toolCalls / stopReason="tool_use"), but the runtime only consumes ' +
        'the fenced-text tool-call protocol. Native tool-request consumption ' +
        'is wired in eshyra-1q5; no adapter should populate the native tool ' +
        'channel until then.',
    );
  }
  return parseToolCalls(result.text);
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
    // Normalize the model's tool requests into the transport-neutral
    // ToolRequest shape before doing anything with them. `collectToolRequests`
    // is the single seam where the fenced parser (today) and native provider
    // tool use (eshyra-1q5) feed the same execution path below; it also holds
    // the eshyra-0jq.25 guard that rejects native responses until that wiring
    // lands.
    const requests = collectToolRequests(result);
    const modelText = result.text;
    if (requests.length === 0) {
      narration = modelText.trim();
      break;
    }

    const roundResults: Array<{ tool: string; result: ToolResult }> = [];
    for (const req of requests) {
      if (req.ok) {
        const result = registry.invoke(req.tool, req.args, toolCtx);
        toolCalls.push({
          tool: req.tool,
          args: req.args,
          result,
          source: req.source,
        });
        roundResults.push({ tool: req.tool, result });
      } else {
        const result: ToolResult = {
          ok: false,
          code: 'parse_error',
          message: req.error,
        };
        toolCalls.push({
          tool: 'unknown',
          args: req.raw,
          result,
          source: req.source,
        });
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
