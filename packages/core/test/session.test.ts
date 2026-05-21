import { describe, expect, it } from 'vitest';
import {
  SessionError,
  closeSession,
  getOpenSession,
  getSession,
  initSchema,
  listSessions,
  openDatabase,
  startSession,
} from '../src/index.js';

const CAMPAIGN = 'campaign-1';

function freshDb() {
  const db = openDatabase(':memory:');
  initSchema(db);
  return db;
}

describe('session lifecycle persistence', () => {
  it('starts a session and exposes it as the resumable open session', () => {
    const db = freshDb();

    const session = startSession(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      startedAt: '2026-05-21T00:00:00.000Z',
    });

    expect(session).toEqual({
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      status: 'open',
      startedAt: '2026-05-21T00:00:00.000Z',
      closedAt: undefined,
    });
    expect(getOpenSession(db, { campaignId: CAMPAIGN })?.sessionId).toBe(
      'session-1',
    );
    expect(getSession(db, { campaignId: CAMPAIGN, sessionId: 'session-1' }))
      .toEqual(session);
    db.close();
  });

  it('enforces at most one open session per campaign', () => {
    const db = freshDb();
    startSession(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      startedAt: '2026-05-21T00:00:00.000Z',
    });

    expect(() =>
      startSession(db, {
        campaignId: CAMPAIGN,
        sessionId: 'session-2',
        startedAt: '2026-05-21T01:00:00.000Z',
      }),
    ).toThrow(SessionError);
    db.close();
  });

  it('closes a session idempotently and allows the next session to start', () => {
    const db = freshDb();
    startSession(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      startedAt: '2026-05-21T00:00:00.000Z',
    });

    const closed = closeSession(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      closedAt: '2026-05-21T02:00:00.000Z',
    });
    const closedAgain = closeSession(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      closedAt: '2026-05-21T03:00:00.000Z',
    });

    expect(closed.status).toBe('closed');
    expect(closed.closedAt).toBe('2026-05-21T02:00:00.000Z');
    expect(closedAgain).toEqual(closed);
    expect(getOpenSession(db, { campaignId: CAMPAIGN })).toBeUndefined();

    const next = startSession(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-2',
      startedAt: '2026-05-21T04:00:00.000Z',
    });
    expect(next.status).toBe('open');
    db.close();
  });

  it('lists sessions in start order and rejects invalid lifecycle inputs', () => {
    const db = freshDb();
    startSession(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      startedAt: '2026-05-21T00:00:00.000Z',
    });
    closeSession(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      closedAt: '2026-05-21T02:00:00.000Z',
    });
    startSession(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-2',
      startedAt: '2026-05-21T04:00:00.000Z',
    });

    expect(listSessions(db, { campaignId: CAMPAIGN }).map((s) => s.sessionId))
      .toEqual(['session-1', 'session-2']);
    expect(() =>
      closeSession(db, {
        campaignId: CAMPAIGN,
        sessionId: 'ghost',
        closedAt: '2026-05-21T02:00:00.000Z',
      }),
    ).toThrow(SessionError);
    expect(() =>
      startSession(db, {
        campaignId: '',
        sessionId: 'session-3',
        startedAt: '2026-05-21T05:00:00.000Z',
      }),
    ).toThrow(SessionError);
    db.close();
  });
});
