import type { Db } from '../persistence/db.js';
import {
  appendSceneLog,
  getOpenScene,
  openScene,
  type SceneRecord,
} from './scene.js';

/**
 * Persist a finished turn's player/DM transcript to the open scene (E5).
 *
 * The orchestrator does not assume the model called `mark_scene` first — it
 * is valid for the model to narrate without scene bookkeeping. When no scene
 * is open at turn end, this module opens an "auto-scene" so a successful turn
 * always has a persisted transcript. The returned `SceneRecord` is the scene
 * that received the turn.
 */

export interface AppendTurnTranscriptInput {
  db: Db;
  campaignId: string;
  sessionId: string;
  turnId: string;
  playerInput: string;
  narration: string;
  at: string;
}

export function appendTurnTranscript(
  input: AppendTurnTranscriptInput,
): SceneRecord {
  const { db, campaignId, sessionId, turnId, playerInput, narration, at } =
    input;

  const activeScene =
    getOpenScene(db, { campaignId, sessionId }) ??
    openScene(db, {
      campaignId,
      sessionId,
      sceneId: `auto-scene-${turnId}`,
      title: 'Untitled Scene',
      at,
    });

  appendSceneLog(db, {
    campaignId,
    sessionId,
    sceneId: activeScene.sceneId,
    turnId,
    role: 'player',
    content: playerInput,
    at,
  });
  appendSceneLog(db, {
    campaignId,
    sessionId,
    sceneId: activeScene.sceneId,
    turnId,
    role: 'dm',
    content: narration,
    at,
  });

  return activeScene;
}
