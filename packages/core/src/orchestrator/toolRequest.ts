import type { ModelCompleteResult } from '../model/client.js';

/**
 * Transport-neutral model-requested tool action (eshyra-0jq.16, prep for
 * eshyra-1q5).
 *
 * The orchestrator drives tools through a single internal representation of "the
 * model asked to run a tool", independent of how that request reached us. Today
 * the only producer is the fenced-text protocol parser (`parseToolCalls` in
 * protocol.ts), which tags its requests `source: 'fenced'`. The planned native
 * provider tool-use transport (eshyra-1q5) will become a second producer
 * (`source: 'native'`) without changing how `runModelLoop` validates and
 * executes requests: the loop consumes {@link ToolRequest}, not a fenced shape.
 *
 * Keeping this abstraction free of any dependency on the turn loop (it does not
 * import `OrchestratorError`) lets both the fenced parser and a future native
 * adapter produce it without a cycle.
 */
export type ToolRequestSource = 'fenced' | 'native';

/**
 * A single tool action the model requested, in document/response order.
 * Malformed requests are represented as `ok: false` entries rather than thrown
 * so the loop can feed the parse error back to the model as a tool result.
 *
 * `callId` carries a provider-assigned tool-call id when the transport supplies
 * one (native tool use); the fenced transport leaves it unset.
 */
export type ToolRequest =
  | {
      readonly ok: true;
      readonly source: ToolRequestSource;
      readonly callId?: string;
      readonly tool: string;
      readonly args: unknown;
    }
  | {
      readonly ok: false;
      readonly source: ToolRequestSource;
      readonly callId?: string;
      readonly error: string;
      readonly raw: string;
    };

/**
 * Whether a model result carries native provider tool calls. This is the
 * transport-neutral detection the loop uses to recognise a native tool-use
 * response. The runtime does not yet consume the native channel (eshyra-1q5),
 * so a `true` here is currently a rejected policy state in `runModelLoop` rather
 * than a second execution path — but the detection lives behind the abstraction
 * so wiring native consumption later does not re-draw the loop boundary.
 */
export function hasNativeToolRequests(result: ModelCompleteResult): boolean {
  return (
    (result.toolCalls !== undefined && result.toolCalls.length > 0) ||
    result.stopReason === 'tool_use'
  );
}
