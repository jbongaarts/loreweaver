import type { TraceJsonValue } from './memory/turnTrace.js';
import {
  memoryDrilldown,
  recordSceneSummary,
  rollupArcSummary,
  rollupSessionRecap,
  type CampaignBibleInput,
} from './memory/summary.js';
import type { Db } from './persistence/db.js';
import { withTransaction } from './persistence/db.js';
import { closeScene, getOpenScene, listSceneLog } from './orchestrator/scene.js';
import {
  closeSession,
  getSession,
  type SessionKey,
  type SessionRecord,
} from './session.js';

export interface SessionCheckpointRunner {
  liveDbPath: string;
  run: (liveDbPath: string, message: string) => string;
}

export interface GracefulSessionArcRollup {
  arcId: string;
  summary: string;
  campaignBible: CampaignBibleInput;
}

export interface CloseSessionGracefullyInput extends SessionKey {
  closedAt: string;
  recap: string;
  stateDelta: TraceJsonValue[];
  checkpoint?: SessionCheckpointRunner;
  arcRollup?: GracefulSessionArcRollup;
}

export interface CloseSessionGracefullyResult {
  session: SessionRecord;
  closedSceneIds: string[];
  checkpointId: string | undefined;
}

export function closeSessionGracefully(
  db: Db,
  input: CloseSessionGracefullyInput,
): CloseSessionGracefullyResult {
  const wasClosed = getSession(db, input)?.status === 'closed';
  const closedSceneIds = withTransaction(db, (txnDb) => {
    const openScene = getOpenScene(txnDb, input);
    if (openScene === undefined) {
      return [];
    }

    closeScene(txnDb, {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      sceneId: openScene.sceneId,
      at: input.closedAt,
    });
    ensureSceneSummary(txnDb, input, openScene.sceneId);
    return [openScene.sceneId];
  });

  rollupSessionRecap(db, {
    campaignId: input.campaignId,
    sessionId: input.sessionId,
    recap: input.recap,
    stateDelta: input.stateDelta,
    createdAt: input.closedAt,
  });

  if (input.arcRollup !== undefined) {
    rollupArcSummary(db, {
      campaignId: input.campaignId,
      arcId: input.arcRollup.arcId,
      summary: input.arcRollup.summary,
      sourceSessionIds: [input.sessionId],
      campaignBible: input.arcRollup.campaignBible,
      createdAt: input.closedAt,
    });
  }

  const session = closeSession(db, {
    campaignId: input.campaignId,
    sessionId: input.sessionId,
    closedAt: input.closedAt,
  });
  const checkpointId =
    wasClosed || input.checkpoint === undefined
      ? undefined
      : input.checkpoint.run(
          input.checkpoint.liveDbPath,
          `session-close: ${input.sessionId}`,
        );

  return {
    session,
    closedSceneIds,
    checkpointId,
  };
}

function ensureSceneSummary(
  db: Db,
  key: SessionKey & { closedAt: string },
  sceneId: string,
): void {
  if (
    memoryDrilldown(db, {
      target: 'scene',
      campaignId: key.campaignId,
      sessionId: key.sessionId,
      sceneId,
    }) !== undefined
  ) {
    return;
  }

  const log = listSceneLog(db, { ...key, sceneId });
  const dmLines = log.filter((e) => e.role === 'dm').map((e) => e.content);
  const summary =
    dmLines.length > 0 ? dmLines.join(' ') : '(scene closed with no narration)';
  recordSceneSummary(db, {
    campaignId: key.campaignId,
    sessionId: key.sessionId,
    sceneId,
    summary,
    salientRefs: [],
    sourceTurnIds: [...new Set(log.map((e) => e.turnId))],
    createdAt: key.closedAt,
    updatedAt: key.closedAt,
  });
}
