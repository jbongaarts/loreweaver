import { getOpenScene, listSceneLog } from '../orchestrator/scene.js';
import type { Db } from '../persistence/db.js';
import { listSceneSummaries } from './summary.js';
import type { TraceJsonValue } from './turnTrace.js';
import { listTurnTraces } from './turnTrace.js';

/**
 * Inputs to {@link composeSessionRecap}.
 */
export interface ComposeSessionRecapInput {
  campaignId: string;
  sessionId: string;
}

/**
 * The recap text + accepted-mutation list a session-close caller hands to
 * {@link closeSessionGracefully}.
 */
export interface ComposeSessionRecapResult {
  recap: string;
  stateDelta: TraceJsonValue[];
}

/**
 * Compose a session recap deterministically from played content.
 *
 * The recap text joins each played scene's summary in scene order: closed
 * scenes read their `scene_summary` (recorded by mark_scene during play); the
 * still-open scene is synthesized from its `scene_log` DM lines on the spot
 * (matching {@link summarizeSceneFromLog}'s join behavior) so the in-flight
 * scene contributes too — the session-close pipeline records its summary
 * separately under the close transaction.
 *
 * `stateDelta` aggregates the `acceptedStateDelta` of every recorded turn in
 * the session, in turn order, so persistent memory reflects what actually
 * mutated canon during play rather than a hardcoded empty list.
 *
 * If no narration is found anywhere a non-empty fallback is returned so the
 * recap row passes `validateSessionRecap`. Pure read; no writes.
 */
export function composeSessionRecap(
  db: Db,
  input: ComposeSessionRecapInput,
): ComposeSessionRecapResult {
  const closedSceneSummaries = listSceneSummaries(db, input).map(
    (summary) => summary.summary,
  );

  const openScene = getOpenScene(db, input);
  const openSceneSummary =
    openScene === undefined
      ? undefined
      : composeOpenSceneNarration(db, {
          campaignId: input.campaignId,
          sessionId: input.sessionId,
          sceneId: openScene.sceneId,
        });

  const sceneSummaries = [
    ...closedSceneSummaries,
    ...(openSceneSummary === undefined ? [] : [openSceneSummary]),
  ];
  const recap =
    sceneSummaries.length === 0
      ? '(session ended with no scenes played)'
      : sceneSummaries.join(' ');

  const stateDelta = listTurnTraces(db, input).flatMap(
    (trace) => trace.acceptedStateDelta,
  );

  return { recap, stateDelta };
}

/**
 * Mirror of {@link summarizeSceneFromLog}'s narration-join: DM lines joined by
 * spaces, or a fallback when the scene has none. Used for the still-open scene
 * whose `scene_summary` row does not exist until the close transaction writes
 * it; reading the log directly lets the recap include in-flight scene content
 * without writing outside the close transaction.
 */
function composeOpenSceneNarration(
  db: Db,
  key: { campaignId: string; sessionId: string; sceneId: string },
): string {
  const dmLines = listSceneLog(db, key)
    .filter((entry) => entry.role === 'dm')
    .map((entry) => entry.content);
  return dmLines.length > 0
    ? dmLines.join(' ')
    : '(scene closed with no narration)';
}
