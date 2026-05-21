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
  SessionError,
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
  const { session, closedSceneIds, needsCheckpoint } = withTransaction(
    db,
    (txnDb) => {
      const existing = getSession(txnDb, input);
      if (existing === undefined) {
        throw new SessionError(
          `cannot close unknown session '${input.sessionId}' in campaign '${input.campaignId}'`,
        );
      }

      // The session being marked closed is NOT proof its checkpoint ran: the
      // checkpoint happens after this transaction commits and can fail there.
      // Only a recorded checkpoint marks the work done, so a failed checkpoint
      // stays retryable on a later close call.
      const needsCheckpoint = !readCheckpointDone(txnDb, input);
      const closedSceneIds: string[] = [];

      // Scene close + rollups + session close run exactly once, on the first
      // close that still finds the session open. A retry after a checkpoint
      // failure finds it already closed and must not repeat or duplicate them.
      if (existing.status === 'open') {
        const openScene = getOpenScene(txnDb, input);
        if (openScene !== undefined) {
          closeScene(txnDb, {
            campaignId: input.campaignId,
            sessionId: input.sessionId,
            sceneId: openScene.sceneId,
            at: input.closedAt,
          });
          ensureSceneSummary(txnDb, input, openScene.sceneId);
          closedSceneIds.push(openScene.sceneId);
        }

        rollupSessionRecap(txnDb, {
          campaignId: input.campaignId,
          sessionId: input.sessionId,
          recap: input.recap,
          stateDelta: input.stateDelta,
          createdAt: input.closedAt,
        });

        if (input.arcRollup !== undefined) {
          rollupArcSummary(txnDb, {
            campaignId: input.campaignId,
            arcId: input.arcRollup.arcId,
            summary: input.arcRollup.summary,
            sourceSessionIds: [input.sessionId],
            campaignBible: input.arcRollup.campaignBible,
            createdAt: input.closedAt,
          });
        }

        const session = closeSession(txnDb, {
          campaignId: input.campaignId,
          sessionId: input.sessionId,
          closedAt: input.closedAt,
        });
        return { session, closedSceneIds, needsCheckpoint };
      }

      return { session: existing, closedSceneIds, needsCheckpoint };
    },
  );

  let checkpointId: string | undefined;
  if (needsCheckpoint && input.checkpoint !== undefined) {
    checkpointId = input.checkpoint.run(
      input.checkpoint.liveDbPath,
      `session-close: ${input.sessionId}`,
    );
    // Recorded only after the checkpoint succeeds. If `run` throws, this is
    // skipped and the next close call retries the checkpoint.
    markCheckpointDone(db, input, checkpointId);
  }

  return {
    session,
    closedSceneIds,
    checkpointId,
  };
}

/**
 * `meta` row recording that a session's close-time checkpoint completed.
 * Its presence — not the session's closed status — is the signal a later
 * close call uses to skip an already-done checkpoint.
 */
function checkpointMetaKey(key: SessionKey): string {
  return `session_checkpoint:${key.campaignId}:${key.sessionId}`;
}

function readCheckpointDone(db: Db, key: SessionKey): boolean {
  return (
    db
      .prepare('SELECT 1 FROM meta WHERE key = ?')
      .get(checkpointMetaKey(key)) !== undefined
  );
}

function markCheckpointDone(
  db: Db,
  key: SessionKey,
  checkpointId: string,
): void {
  db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run(
    checkpointMetaKey(key),
    checkpointId,
  );
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
