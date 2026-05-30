import {
  getOpenScene,
  listSceneLog,
  type SceneLogRecord,
  type SceneRecord,
} from './orchestrator/scene.js';
import type { Db } from './persistence/db.js';
import {
  type CampaignSelector,
  getOpenSession,
  type SessionRecord,
} from './session.js';

export type SessionLaunchState =
  | {
      kind: 'start_new';
      campaignId: string;
    }
  | {
      kind: 'resume';
      campaignId: string;
      session: SessionRecord;
      openScene: SceneRecord | undefined;
      sceneTail: SceneLogRecord[];
    };

export function getSessionLaunchState(
  db: Db,
  selector: CampaignSelector,
): SessionLaunchState {
  const session = getOpenSession(db, selector);
  if (session === undefined) {
    return {
      kind: 'start_new',
      campaignId: selector.campaignId,
    };
  }

  const openScene = getOpenScene(db, {
    campaignId: selector.campaignId,
    sessionId: session.sessionId,
  });
  const sceneTail =
    openScene === undefined
      ? []
      : listSceneLog(db, {
          campaignId: selector.campaignId,
          sessionId: session.sessionId,
          sceneId: openScene.sceneId,
        });

  return {
    kind: 'resume',
    campaignId: selector.campaignId,
    session,
    openScene,
    sceneTail,
  };
}
