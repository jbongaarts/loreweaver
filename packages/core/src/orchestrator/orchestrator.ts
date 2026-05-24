import type { Db } from '../persistence/db.js';
import type { ModelClient, ModelMessage } from '../model/client.js';
import type { TraceJsonValue, TurnTraceConsentScope } from '../memory/turnTrace.js';
import { recordTurnTrace } from '../memory/turnTrace.js';
import { summarizeSceneFromLog } from '../memory/summary.js';
import { createSeededRng } from './rng.js';
import { ToolRegistry, isMarkSceneToolData } from './tools.js';
import type { ToolContext, ToolResult } from './tools.js';
import { assembleContext, renderContextMessage } from './contextAssembler.js';
import {
  buildSystemPrompt,
  parseToolCalls,
  renderToolResults,
} from './protocol.js';
import { appendSceneLog, getOpenScene, openScene } from './scene.js';

/**
 * Orchestrator turn loop (E5) — the integrating loop.
 *
 * One player turn: assemble bounded context, call the model, parse + execute
 * tool calls deterministically, feed results back, and capture the final
 * tool-call-free narration. The turn then appends the player line and DM
 * narration to the open scene's log, records a turn trace, and writes a
 * scene_summary for any scene the model closed this turn.
 *
 * The whole turn runs inside a SQLite SAVEPOINT: a model/SDK failure or an
 * exhausted tool budget rolls back every write, leaving pre-turn state intact.
 * Narration that is not a tool call never mutates canon — only the tool layer
 * writes.
 *
 * Fills the Orchestrator seam.
 */

const TURN_SAVEPOINT = 'loreweaver_turn';
const DEFAULT_MAX_TOOL_ROUNDS = 8;

export class OrchestratorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrchestratorError';
  }
}

export interface RunTurnDeps {
  db: Db;
  model: ModelClient;
  registry: ToolRegistry;
}

export interface RunTurnInput {
  campaignId: string;
  sessionId: string;
  turnId: string;
  playerInput: string;
  /** Seed for this turn's code-owned RNG — makes the turn reproducible. */
  seed: number;
  /** ISO timestamp stamped on every write this turn. */
  at: string;
  consentScope?: TurnTraceConsentScope;
  promptProfile?: string;
  recentSessionLimit?: number;
  maxToolRounds?: number;
}

export interface ExecutedToolCall {
  tool: string;
  args: unknown;
  result: ToolResult;
}

export interface RunTurnResult {
  ok: boolean;
  turnId: string;
  narration: string;
  toolCalls: ExecutedToolCall[];
  /** Scene the turn was logged into, if any was open at turn end. */
  sceneId: string | undefined;
  modelRounds: number;
  error: string | undefined;
}

function isClosedSceneResult(call: ExecutedToolCall): string | undefined {
  if (call.tool !== 'mark_scene' || !call.result.ok) {
    return undefined;
  }
  if (!isMarkSceneToolData(call.result.data)) {
    return undefined;
  }
  return call.result.data.boundary === 'close'
    ? call.result.data.scene.sceneId
    : undefined;
}

interface DerivedTraceFields {
  rulesResolution: TraceJsonValue;
  acceptedStateDelta: TraceJsonValue[];
  rejectedCandidates: TraceJsonValue[];
  memoryUpdates: TraceJsonValue[];
  qualityFlags: string[];
}

/**
 * Project a turn's executed tool calls into the structured turn-trace fields,
 * so the trace records what actually happened rather than placeholders:
 * - `acceptedStateDelta` — canon mutations the tool layer applied.
 * - `rejectedCandidates` — mutations / tool calls the model proposed that a
 *   tool refused (invalid args, unknown tool, malformed tool call).
 * - `rulesResolution` — the deterministic-layer outcomes (dice, SRD lookups).
 * - `memoryUpdates` — scene summaries the turn rolled up.
 * - `qualityFlags` — signals worth surfacing for later review.
 *
 * `humanCorrections` has no source in an unattended turn and stays empty.
 */
function deriveTraceFields(
  toolCalls: readonly ExecutedToolCall[],
  summarizedSceneIds: readonly string[],
): DerivedTraceFields {
  const argsOf = (call: ExecutedToolCall): TraceJsonValue =>
    (call.args ?? null) as TraceJsonValue;
  const okData = (tool: string): TraceJsonValue[] =>
    toolCalls
      .filter((call) => call.tool === tool && call.result.ok)
      .map((call) =>
        call.result.ok ? (call.result.data as TraceJsonValue) : null,
      );

  const acceptedStateDelta = toolCalls
    .filter((call) => call.tool === 'mutate_state' && call.result.ok)
    .map(argsOf);

  const rejectedCandidates = toolCalls
    .filter((call) => !call.result.ok)
    .map(
      (call): TraceJsonValue => ({
        tool: call.tool,
        args: argsOf(call),
        code: call.result.ok ? null : call.result.code,
        message: call.result.ok ? null : call.result.message,
      }),
    );

  const qualityFlags: string[] = [];
  if (toolCalls.some((call) => call.tool === 'unknown')) {
    qualityFlags.push('tool_parse_error');
  }
  if (toolCalls.some((call) => call.tool !== 'unknown' && !call.result.ok)) {
    qualityFlags.push('tool_error');
  }

  return {
    rulesResolution: {
      rolls: okData('roll'),
      rulesLookups: okData('lookup_rules'),
    },
    acceptedStateDelta,
    rejectedCandidates,
    memoryUpdates: summarizedSceneIds.map(
      (sceneId): TraceJsonValue => ({ kind: 'scene_summary', sceneId }),
    ),
    qualityFlags,
  };
}

export async function runTurn(
  deps: RunTurnDeps,
  input: RunTurnInput,
): Promise<RunTurnResult> {
  const { db, model, registry } = deps;
  const maxToolRounds = input.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
  const toolCtx: ToolContext = {
    db,
    rng: createSeededRng(input.seed),
    campaignId: input.campaignId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    at: input.at,
  };

  const toolCalls: ExecutedToolCall[] = [];
  let rounds = 0;

  db.exec(`SAVEPOINT ${TURN_SAVEPOINT}`);
  try {
    const assembled = assembleContext({
      db,
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      playerInput: input.playerInput,
      recentSessionLimit: input.recentSessionLimit,
    });
    const system = buildSystemPrompt(registry);
    const messages: ModelMessage[] = [
      { role: 'user', content: renderContextMessage(assembled) },
    ];

    let narration: string | undefined;
    while (rounds < maxToolRounds) {
      rounds += 1;
      const modelText = await model.complete({ system, messages });
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

    // Summarize any scene the model closed this turn.
    const closedSceneIds = [
      ...new Set(
        toolCalls
          .map(isClosedSceneResult)
          .filter((id): id is string => id !== undefined),
      ),
    ];
    for (const sceneId of closedSceneIds) {
      summarizeSceneFromLog(
        db,
        {
          campaignId: input.campaignId,
          sessionId: input.sessionId,
          sceneId,
        },
        input.at,
      );
    }

    // Append the turn to whatever scene is open at turn end. If the model
    // never marked a scene this session, open a fallback one so a successful
    // turn always has a persisted player/DM transcript.
    const activeScene =
      getOpenScene(db, {
        campaignId: input.campaignId,
        sessionId: input.sessionId,
      }) ??
      openScene(db, {
        campaignId: input.campaignId,
        sessionId: input.sessionId,
        sceneId: `auto-scene-${input.turnId}`,
        title: 'Untitled Scene',
        at: input.at,
      });
    appendSceneLog(db, {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      sceneId: activeScene.sceneId,
      turnId: input.turnId,
      role: 'player',
      content: input.playerInput,
      at: input.at,
    });
    appendSceneLog(db, {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      sceneId: activeScene.sceneId,
      turnId: input.turnId,
      role: 'dm',
      content: narration,
      at: input.at,
    });

    recordTurnTrace(db, {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      consentScope: input.consentScope ?? 'private',
      playerInput: input.playerInput,
      retrievedContext: [renderContextMessage(assembled)],
      promptProfile: input.promptProfile ?? 'default',
      modelOutput: narration,
      toolCalls: toolCalls.map(
        (c): TraceJsonValue => ({
          tool: c.tool,
          args: (c.args ?? null) as TraceJsonValue,
          result: c.result as unknown as TraceJsonValue,
        }),
      ),
      ...deriveTraceFields(toolCalls, closedSceneIds),
      finalNarration: narration,
      humanCorrections: [],
      createdAt: input.at,
    });

    db.exec(`RELEASE ${TURN_SAVEPOINT}`);
    return {
      ok: true,
      turnId: input.turnId,
      narration,
      toolCalls,
      sceneId: activeScene.sceneId,
      modelRounds: rounds,
      error: undefined,
    };
  } catch (e) {
    db.exec(`ROLLBACK TO ${TURN_SAVEPOINT}`);
    db.exec(`RELEASE ${TURN_SAVEPOINT}`);
    return {
      ok: false,
      turnId: input.turnId,
      narration: '',
      toolCalls: [],
      sceneId: undefined,
      modelRounds: rounds,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
