import { describe, expect, it } from 'vitest';
import {
  SceneError,
  appendSceneLog,
  closeScene,
  closeSession,
  getOpenScene,
  getScene,
  listSceneLog,
  openScene,
} from '../src/index.js';
import { bareDb, freshDbWithSession } from './support/db.js';

const CAMPAIGN = 'campaign-1';
const SESSION = 'session-1';

describe('scene persistence', () => {
  it('opens a scene as the current open scene', () => {
    const db = freshDbWithSession();
    const record = openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      title: 'The Tavern',
      at: '2026-05-20T10:00:00.000Z',
    });

    expect(record.status).toBe('open');
    expect(record.title).toBe('The Tavern');
    expect(record.openedAt).toBe('2026-05-20T10:00:00.000Z');
    expect(record.closedAt).toBeUndefined();

    const open = getOpenScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
    });
    expect(open?.sceneId).toBe('scene-1');
    db.close();
  });

  it('refuses to open a second scene while one is still open', () => {
    const db = freshDbWithSession();
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      title: 'The Tavern',
      at: '2026-05-20T10:00:00.000Z',
    });

    expect(() =>
      openScene(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        sceneId: 'scene-2',
        title: 'The Road',
        at: '2026-05-20T11:00:00.000Z',
      }),
    ).toThrow(SceneError);
    db.close();
  });

  it('closes a scene and frees the session for the next scene', () => {
    const db = freshDbWithSession();
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      title: 'The Tavern',
      at: '2026-05-20T10:00:00.000Z',
    });
    const closed = closeScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      at: '2026-05-20T10:30:00.000Z',
    });

    expect(closed.status).toBe('closed');
    expect(closed.closedAt).toBe('2026-05-20T10:30:00.000Z');
    expect(
      getOpenScene(db, { campaignId: CAMPAIGN, sessionId: SESSION }),
    ).toBeUndefined();

    const next = openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-2',
      title: 'The Road',
      at: '2026-05-20T11:00:00.000Z',
    });
    expect(next.sceneId).toBe('scene-2');
    db.close();
  });

  it('rejects closing an unknown or already-closed scene', () => {
    const db = freshDbWithSession();
    expect(() =>
      closeScene(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        sceneId: 'ghost',
        at: '2026-05-20T10:30:00.000Z',
      }),
    ).toThrow(SceneError);

    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      title: 'The Tavern',
      at: '2026-05-20T10:00:00.000Z',
    });
    closeScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      at: '2026-05-20T10:30:00.000Z',
    });
    expect(() =>
      closeScene(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        sceneId: 'scene-1',
        at: '2026-05-20T10:45:00.000Z',
      }),
    ).toThrow(SceneError);
    db.close();
  });

  it('appends scene-log entries with monotonic per-scene sequence', () => {
    const db = freshDbWithSession();
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      title: 'The Tavern',
      at: '2026-05-20T10:00:00.000Z',
    });

    const first = appendSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      turnId: 'turn-1',
      role: 'player',
      content: 'I walk into the tavern.',
      at: '2026-05-20T10:01:00.000Z',
    });
    const second = appendSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      turnId: 'turn-1',
      role: 'dm',
      content: 'The barkeep eyes you warily.',
      at: '2026-05-20T10:01:00.000Z',
    });

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);

    const log = listSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
    });
    expect(log.map((e) => e.role)).toEqual(['player', 'dm']);
    expect(log.map((e) => e.seq)).toEqual([1, 2]);
    expect(log[0].content).toBe('I walk into the tavern.');
    db.close();
  });

  it('keeps scene-log sequence independent per scene', () => {
    const db = freshDbWithSession();
    for (const sceneId of ['scene-1', 'scene-2']) {
      openScene(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        sceneId,
        title: sceneId,
        at: '2026-05-20T10:00:00.000Z',
      });
      appendSceneLog(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        sceneId,
        turnId: 'turn-1',
        role: 'player',
        content: `hello from ${sceneId}`,
        at: '2026-05-20T10:01:00.000Z',
      });
      closeScene(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        sceneId,
        at: '2026-05-20T10:30:00.000Z',
      });
    }
    expect(
      listSceneLog(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        sceneId: 'scene-2',
      })[0].seq,
    ).toBe(1);
    db.close();
  });

  it('rejects appending to an unknown scene', () => {
    const db = freshDbWithSession();
    expect(() =>
      appendSceneLog(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        sceneId: 'ghost',
        turnId: 'turn-1',
        role: 'player',
        content: 'hello',
        at: '2026-05-20T10:01:00.000Z',
      }),
    ).toThrow(SceneError);
    db.close();
  });

  it('reads a scene by key and reports unknown scenes as undefined', () => {
    const db = freshDbWithSession();
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      title: 'The Tavern',
      at: '2026-05-20T10:00:00.000Z',
    });
    expect(
      getScene(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        sceneId: 'scene-1',
      })?.title,
    ).toBe('The Tavern');
    expect(
      getScene(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        sceneId: 'nope',
      }),
    ).toBeUndefined();
    db.close();
  });

  it('rejects opening a scene for a session that does not exist', () => {
    const db = bareDb();
    expect(() =>
      openScene(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        sceneId: 'scene-1',
        title: 'The Tavern',
        at: '2026-05-20T10:00:00.000Z',
      }),
    ).toThrow(SceneError);
    db.close();
  });

  it('rejects opening a scene for a closed session', () => {
    const db = freshDbWithSession();
    closeSession(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      closedAt: '2026-05-20T12:00:00.000Z',
    });
    expect(() =>
      openScene(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        sceneId: 'scene-1',
        title: 'The Tavern',
        at: '2026-05-20T13:00:00.000Z',
      }),
    ).toThrow(SceneError);
    db.close();
  });

  it('rejects appending a scene log once its session is closed', () => {
    const db = freshDbWithSession();
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      title: 'The Tavern',
      at: '2026-05-20T10:00:00.000Z',
    });
    closeSession(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      closedAt: '2026-05-20T12:00:00.000Z',
    });
    expect(() =>
      appendSceneLog(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        sceneId: 'scene-1',
        turnId: 'turn-1',
        role: 'player',
        content: 'too late',
        at: '2026-05-20T13:00:00.000Z',
      }),
    ).toThrow(SceneError);
    db.close();
  });

  it('rejects missing required fields', () => {
    const db = freshDbWithSession();
    expect(() =>
      openScene(db, {
        campaignId: '',
        sessionId: SESSION,
        sceneId: 'scene-1',
        title: 'The Tavern',
        at: '2026-05-20T10:00:00.000Z',
      }),
    ).toThrow(SceneError);
    db.close();
  });
});
