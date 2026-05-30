import { rollupSessionRecap, summarizeSceneFromLog } from './memory/summary.js';
import type { TraceJsonValue } from './memory/turnTrace.js';
import { closeScene, getOpenScene } from './orchestrator/scene.js';
import type { Db } from './persistence/db.js';
import { withTransaction } from './persistence/db.js';
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

export interface CloseSessionGracefullyInput extends SessionKey {
  closedAt: string;
  recap: string;
  stateDelta: TraceJsonValue[];
  checkpoint?: SessionCheckpointRunner;
  /**
   * When provided, stamps the just-closed session's `arc_id` inside the same
   * DB transaction that commits the session close. This makes the stamp atomic
   * with the close: a crash between them cannot leave the session closed with
   * `arc_id=NULL`.
   */
  arcStamp?: { arcId: string };
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
          summarizeSceneFromLog(
            txnDb,
            {
              campaignId: input.campaignId,
              sessionId: input.sessionId,
              sceneId: openScene.sceneId,
            },
            input.closedAt,
          );
          closedSceneIds.push(openScene.sceneId);
        }

        rollupSessionRecap(txnDb, {
          campaignId: input.campaignId,
          sessionId: input.sessionId,
          recap: input.recap,
          stateDelta: input.stateDelta,
          createdAt: input.closedAt,
        });

        const session = closeSession(txnDb, {
          campaignId: input.campaignId,
          sessionId: input.sessionId,
          closedAt: input.closedAt,
        });

        if (input.arcStamp !== undefined) {
          txnDb
            .prepare(
              `UPDATE campaign_session
               SET arc_id = ?
               WHERE campaign_id = ? AND session_id = ?`,
            )
            .run(input.arcStamp.arcId, input.campaignId, input.sessionId);
        }

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
