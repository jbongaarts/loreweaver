import { summarizeSceneFromLog } from '../memory/summary.js';
import type { Db } from '../persistence/db.js';

/**
 * Scene-close summarization hook (E5).
 *
 * When the `mark_scene` tool closes one or more scenes during a turn, the
 * orchestrator rolls the closed scene log into a `scene_summary` row so
 * subsequent context assembly has a compact memory of what happened. This
 * module is just the orchestrator-side fan-out over the closed scene ids;
 * the actual rollup lives in `memory/summary`.
 */

export interface SummarizeClosedScenesInput {
  db: Db;
  campaignId: string;
  sessionId: string;
  sceneIds: readonly string[];
  at: string;
}

export function summarizeClosedScenes(input: SummarizeClosedScenesInput): void {
  const { db, campaignId, sessionId, sceneIds, at } = input;
  for (const sceneId of sceneIds) {
    summarizeSceneFromLog(db, { campaignId, sessionId, sceneId }, at);
  }
}
