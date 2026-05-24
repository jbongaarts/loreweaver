import { describe, expect, it } from 'vitest';
import {
  appendSceneLog,
  closeSession,
  getSessionLaunchState,
  openScene,
  startSession,
} from '../src/internal.js';
import { bareDb } from './support/db.js';

const CAMPAIGN = 'campaign-1';

describe('session launch state', () => {
  it('reports start-new when no session is open', () => {
    const db = bareDb();

    expect(getSessionLaunchState(db, { campaignId: CAMPAIGN })).toEqual({
      kind: 'start_new',
      campaignId: CAMPAIGN,
    });

    db.close();
  });

  it('reports resume with the current scene tail when a session was left open', () => {
    const db = bareDb();
    startSession(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      startedAt: '2026-05-21T00:00:00.000Z',
    });
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      sceneId: 'scene-1',
      title: 'The Road',
      at: '2026-05-21T00:01:00.000Z',
    });
    appendSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      sceneId: 'scene-1',
      turnId: 'turn-1',
      role: 'player',
      content: 'I check the mile marker.',
      at: '2026-05-21T00:02:00.000Z',
    });
    appendSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      sceneId: 'scene-1',
      turnId: 'turn-1',
      role: 'dm',
      content: 'The chalk sigil still points north.',
      at: '2026-05-21T00:02:00.000Z',
    });

    const state = getSessionLaunchState(db, { campaignId: CAMPAIGN });

    expect(state.kind).toBe('resume');
    if (state.kind === 'resume') {
      expect(state.session.sessionId).toBe('session-1');
      expect(state.openScene?.sceneId).toBe('scene-1');
      expect(state.sceneTail.map((entry) => entry.content)).toEqual([
        'I check the mile marker.',
        'The chalk sigil still points north.',
      ]);
    }
    db.close();
  });

  it('returns start-new after the previously open session is closed', () => {
    const db = bareDb();
    startSession(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      startedAt: '2026-05-21T00:00:00.000Z',
    });
    closeSession(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      closedAt: '2026-05-21T01:00:00.000Z',
    });

    expect(getSessionLaunchState(db, { campaignId: CAMPAIGN })).toEqual({
      kind: 'start_new',
      campaignId: CAMPAIGN,
    });
    db.close();
  });
});
