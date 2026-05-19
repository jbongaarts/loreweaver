import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';

export type TurnTraceConsentScope = 'private' | 'training_allowed';
export type TraceJsonValue =
  | string
  | number
  | boolean
  | null
  | TraceJsonValue[]
  | { [key: string]: TraceJsonValue };

export interface TurnTraceRecord {
  campaignId: string;
  sessionId: string;
  turnId: string;
  consentScope: TurnTraceConsentScope;
  playerInput: string;
  retrievedContext: TraceJsonValue[];
  promptProfile: string;
  modelOutput: string;
  toolCalls: TraceJsonValue[];
  rulesResolution: TraceJsonValue;
  acceptedStateDelta: TraceJsonValue[];
  rejectedCandidates: TraceJsonValue[];
  finalNarration: string;
  memoryUpdates: TraceJsonValue[];
  humanCorrections: string[];
  qualityFlags: string[];
  createdAt: string;
}

export interface TurnTraceKey {
  campaignId: string;
  sessionId: string;
  turnId: string;
}

export class TurnTraceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TurnTraceError';
  }
}

export function recordTurnTrace(db: Db, trace: TurnTraceRecord): void {
  validateTrace(trace);
  withTransaction(db, (txnDb) => {
    txnDb
      .prepare(
        `INSERT INTO turn_trace(
           campaign_id,
           session_id,
           turn_id,
           consent_scope,
           player_input,
           retrieved_context_json,
           prompt_profile,
           model_output,
           tool_calls_json,
           rules_resolution_json,
           accepted_state_delta_json,
           rejected_candidates_json,
           final_narration,
           memory_updates_json,
           human_corrections_json,
           quality_flags_json,
           created_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(campaign_id, session_id, turn_id) DO UPDATE SET
           consent_scope = excluded.consent_scope,
           player_input = excluded.player_input,
           retrieved_context_json = excluded.retrieved_context_json,
           prompt_profile = excluded.prompt_profile,
           model_output = excluded.model_output,
           tool_calls_json = excluded.tool_calls_json,
           rules_resolution_json = excluded.rules_resolution_json,
           accepted_state_delta_json = excluded.accepted_state_delta_json,
           rejected_candidates_json = excluded.rejected_candidates_json,
           final_narration = excluded.final_narration,
           memory_updates_json = excluded.memory_updates_json,
           human_corrections_json = excluded.human_corrections_json,
           quality_flags_json = excluded.quality_flags_json,
           created_at = excluded.created_at`,
      )
      .run(
        trace.campaignId,
        trace.sessionId,
        trace.turnId,
        trace.consentScope,
        trace.playerInput,
        stringifyTraceJson(trace.retrievedContext),
        trace.promptProfile,
        trace.modelOutput,
        stringifyTraceJson(trace.toolCalls),
        stringifyTraceJson(trace.rulesResolution),
        stringifyTraceJson(trace.acceptedStateDelta),
        stringifyTraceJson(trace.rejectedCandidates),
        trace.finalNarration,
        stringifyTraceJson(trace.memoryUpdates),
        stringifyTraceJson(trace.humanCorrections),
        stringifyTraceJson(trace.qualityFlags),
        trace.createdAt,
      );
  });
}

export function getTurnTrace(
  db: Db,
  key: TurnTraceKey,
): TurnTraceRecord | undefined {
  const row = db
    .prepare(
      `SELECT
         campaign_id,
         session_id,
         turn_id,
         consent_scope,
         player_input,
         retrieved_context_json,
         prompt_profile,
         model_output,
         tool_calls_json,
         rules_resolution_json,
         accepted_state_delta_json,
         rejected_candidates_json,
         final_narration,
         memory_updates_json,
         human_corrections_json,
         quality_flags_json,
         created_at
       FROM turn_trace
       WHERE campaign_id = ? AND session_id = ? AND turn_id = ?`,
    )
    .get(key.campaignId, key.sessionId, key.turnId) as
    | TurnTraceRow
    | undefined;

  if (row === undefined) {
    return undefined;
  }
  return {
    campaignId: row.campaign_id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    consentScope: row.consent_scope as TurnTraceConsentScope,
    playerInput: row.player_input,
    retrievedContext: parseTraceJson(row.retrieved_context_json) as TraceJsonValue[],
    promptProfile: row.prompt_profile,
    modelOutput: row.model_output,
    toolCalls: parseTraceJson(row.tool_calls_json) as TraceJsonValue[],
    rulesResolution: parseTraceJson(row.rules_resolution_json),
    acceptedStateDelta: parseTraceJson(
      row.accepted_state_delta_json,
    ) as TraceJsonValue[],
    rejectedCandidates: parseTraceJson(
      row.rejected_candidates_json,
    ) as TraceJsonValue[],
    finalNarration: row.final_narration,
    memoryUpdates: parseTraceJson(row.memory_updates_json) as TraceJsonValue[],
    humanCorrections: parseTraceJson(row.human_corrections_json) as string[],
    qualityFlags: parseTraceJson(row.quality_flags_json) as string[],
    createdAt: row.created_at,
  };
}

function validateTrace(trace: TurnTraceRecord): void {
  for (const [field, value] of [
    ['campaignId', trace.campaignId],
    ['sessionId', trace.sessionId],
    ['turnId', trace.turnId],
    ['playerInput', trace.playerInput],
    ['promptProfile', trace.promptProfile],
    ['modelOutput', trace.modelOutput],
    ['finalNarration', trace.finalNarration],
    ['createdAt', trace.createdAt],
  ] as const) {
    if (value.length === 0) {
      throw new TurnTraceError(`turn trace ${field} is required`);
    }
  }
}

function stringifyTraceJson(value: TraceJsonValue | TraceJsonValue[]): string {
  return JSON.stringify(value);
}

function parseTraceJson(value: string): TraceJsonValue {
  return JSON.parse(value) as TraceJsonValue;
}

interface TurnTraceRow {
  campaign_id: string;
  session_id: string;
  turn_id: string;
  consent_scope: string;
  player_input: string;
  retrieved_context_json: string;
  prompt_profile: string;
  model_output: string;
  tool_calls_json: string;
  rules_resolution_json: string;
  accepted_state_delta_json: string;
  rejected_candidates_json: string;
  final_narration: string;
  memory_updates_json: string;
  human_corrections_json: string;
  quality_flags_json: string;
  created_at: string;
}
