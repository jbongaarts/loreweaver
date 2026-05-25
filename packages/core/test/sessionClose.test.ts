import { describe, expect, it } from 'vitest';
import {
  appendSceneLog,
  closeSessionGracefully,
  getOpenScene,
  getOpenSession,
  getSession,
  getSessionRecap,
  listSceneSummaries,
  openScene,
  startSession,
  withTransaction,
} from '../src/internal.js';
import { bareDb } from './support/db.js';

const CAMPAIGN = 'campaign-1';
const SESSION = 'session-1';

describe('graceful session close pipeline', () => {
  it('closes the open scene, writes rollups, checkpoints, and marks the session closed', () => {
    const db = bareDb();
    const checkpoints: string[] = [];
    startSession(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      startedAt: '2026-05-21T00:00:00.000Z',
    });
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      title: 'The Road',
      at: '2026-05-21T00:01:00.000Z',
    });
    appendSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      turnId: 'turn-1',
      role: 'player',
      content: 'I search the old mile marker.',
      at: '2026-05-21T00:02:00.000Z',
    });
    appendSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      turnId: 'turn-1',
      role: 'dm',
      content: 'You find a fresh chalk sigil pointing north.',
      at: '2026-05-21T00:02:00.000Z',
    });

    const result = closeSessionGracefully(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      closedAt: '2026-05-21T01:00:00.000Z',
      recap: 'The mile marker sigil points north.',
      stateDelta: [{ target: 'plot_flags', field: 'found_mile_marker_sigil' }],
      checkpoint: {
        liveDbPath: 'campaign.db',
        run: (liveDbPath, message) => {
          checkpoints.push(`${liveDbPath} ${message}`);
          return 'checkpoint-1';
        },
      },
    });

    expect(result.session.status).toBe('closed');
    expect(result.closedSceneIds).toEqual(['scene-1']);
    expect(result.checkpointId).toBe('checkpoint-1');
    expect(getOpenSession(db, { campaignId: CAMPAIGN })).toBeUndefined();
    expect(
      getOpenScene(db, { campaignId: CAMPAIGN, sessionId: SESSION }),
    ).toBeUndefined();
    expect(
      listSceneSummaries(db, { campaignId: CAMPAIGN, sessionId: SESSION }),
    ).toEqual([
      {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        sceneId: 'scene-1',
        summary: 'You find a fresh chalk sigil pointing north.',
        salientRefs: [],
        sourceTurnIds: ['turn-1'],
        createdAt: '2026-05-21T01:00:00.000Z',
        updatedAt: '2026-05-21T01:00:00.000Z',
      },
    ]);
    expect(
      getSessionRecap(db, { campaignId: CAMPAIGN, sessionId: SESSION })?.recap,
    ).toBe('The mile marker sigil points north.');
    expect(checkpoints).toEqual(['campaign.db session-close: session-1']);
    db.close();
  });

  it('can be rerun without duplicating rollups or repeating an already completed checkpoint', () => {
    const db = bareDb();
    let checkpointCount = 0;
    startSession(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      startedAt: '2026-05-21T00:00:00.000Z',
    });
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      title: 'The Road',
      at: '2026-05-21T00:01:00.000Z',
    });

    const input = {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      closedAt: '2026-05-21T01:00:00.000Z',
      recap: 'The session closes cleanly.',
      stateDelta: [],
      checkpoint: {
        liveDbPath: 'campaign.db',
        run: () => {
          checkpointCount += 1;
          return `checkpoint-${checkpointCount}`;
        },
      },
    } as const;

    const first = closeSessionGracefully(db, input);
    const second = closeSessionGracefully(db, input);

    expect(first.checkpointId).toBe('checkpoint-1');
    expect(second.checkpointId).toBeUndefined();
    expect(checkpointCount).toBe(1);
    expect(
      listSceneSummaries(db, { campaignId: CAMPAIGN, sessionId: SESSION }),
    ).toHaveLength(1);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM session_recap').get(),
    ).toEqual({ count: 1 });
    db.close();
  });

  it('retries the checkpoint after a close-time checkpoint failure', () => {
    const db = bareDb();
    startSession(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      startedAt: '2026-05-21T00:00:00.000Z',
    });
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      title: 'The Road',
      at: '2026-05-21T00:01:00.000Z',
    });

    let attempts = 0;
    const input = {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      closedAt: '2026-05-21T01:00:00.000Z',
      recap: 'The session closes cleanly.',
      stateDelta: [],
      checkpoint: {
        liveDbPath: 'campaign.db',
        run: () => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error('dolt unavailable');
          }
          return `checkpoint-${attempts}`;
        },
      },
    } as const;

    // First close: rollups + session close commit, then the checkpoint fails.
    expect(() => closeSessionGracefully(db, input)).toThrow('dolt unavailable');
    expect(
      getSession(db, { campaignId: CAMPAIGN, sessionId: SESSION })?.status,
    ).toBe('closed');

    // Retry: the checkpoint runs again and succeeds; rollups are not repeated
    // and the session is not reopened.
    const retry = closeSessionGracefully(db, input);
    expect(retry.checkpointId).toBe('checkpoint-2');
    expect(attempts).toBe(2);
    expect(
      getSession(db, { campaignId: CAMPAIGN, sessionId: SESSION })?.status,
    ).toBe('closed');
    expect(
      listSceneSummaries(db, { campaignId: CAMPAIGN, sessionId: SESSION }),
    ).toHaveLength(1);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM session_recap').get(),
    ).toEqual({ count: 1 });

    // A further close once the checkpoint has succeeded is a no-op for it.
    const third = closeSessionGracefully(db, input);
    expect(third.checkpointId).toBeUndefined();
    expect(attempts).toBe(2);
    db.close();
  });

  it('rejects an unknown session before writing rollups', () => {
    const db = bareDb();

    expect(() =>
      closeSessionGracefully(db, {
        campaignId: CAMPAIGN,
        sessionId: 'missing',
        closedAt: '2026-05-21T01:00:00.000Z',
        recap: 'This should not be written.',
        stateDelta: [],
      }),
    ).toThrow("cannot close unknown session 'missing'");

    expect(
      getSessionRecap(db, { campaignId: CAMPAIGN, sessionId: 'missing' }),
    ).toBeUndefined();
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM session_recap').get(),
    ).toEqual({ count: 0 });
    db.close();
  });

  it('rolls back scene close, summaries, recap, and session close on outer transaction abort', () => {
    const db = bareDb();
    startSession(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      startedAt: '2026-05-21T00:00:00.000Z',
    });
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      title: 'The Road',
      at: '2026-05-21T00:01:00.000Z',
    });
    appendSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      turnId: 'turn-1',
      role: 'dm',
      content: 'The road bends north.',
      at: '2026-05-21T00:02:00.000Z',
    });

    // Wrap closeSessionGracefully in an outer transaction that aborts after the
    // inner close commits its savepoint. The outer abort rolls back the savepoint
    // too, so the session remains open and no recap is written.
    let threw = false;
    try {
      withTransaction(db, (txnDb) => {
        closeSessionGracefully(txnDb, {
          campaignId: CAMPAIGN,
          sessionId: SESSION,
          closedAt: '2026-05-21T01:00:00.000Z',
          recap: 'The road bends north.',
          stateDelta: [],
        });
        throw new Error('simulated crash after close');
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    expect(
      getSession(db, { campaignId: CAMPAIGN, sessionId: SESSION })?.status,
    ).toBe('open');
    expect(getOpenSession(db, { campaignId: CAMPAIGN })?.sessionId).toBe(
      SESSION,
    );
    expect(
      getOpenScene(db, { campaignId: CAMPAIGN, sessionId: SESSION })?.sceneId,
    ).toBe('scene-1');
    expect(
      listSceneSummaries(db, { campaignId: CAMPAIGN, sessionId: SESSION }),
    ).toEqual([]);
    expect(
      getSessionRecap(db, { campaignId: CAMPAIGN, sessionId: SESSION }),
    ).toBeUndefined();
    db.close();
  });

  it('stamps arc_id atomically with session close when arcStamp is provided', () => {
    // Verify that arcStamp.arcId is set on the session inside the same
    // transaction as the session close. We prove atomicity by wrapping both in
    // an outer withTransaction that aborts: neither the session close nor the
    // arc stamp should be visible after the abort.
    const db = bareDb();
    startSession(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      startedAt: '2026-05-21T00:00:00.000Z',
    });

    // First: verify the happy path — arcStamp is committed with the close.
    closeSessionGracefully(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      closedAt: '2026-05-21T01:00:00.000Z',
      recap: 'Arc stamp test.',
      stateDelta: [],
      arcStamp: { arcId: 'arc-42' },
    });

    const row = db
      .prepare(
        `SELECT arc_id, status FROM campaign_session
         WHERE campaign_id = ? AND session_id = ?`,
      )
      .get(CAMPAIGN, SESSION) as
      | { arc_id: string | null; status: string }
      | undefined;

    expect(row?.status).toBe('closed');
    expect(row?.arc_id).toBe('arc-42');

    // Second: verify atomicity — if the outer transaction aborts, neither the
    // session close nor the arc stamp persists.
    const SESSION2 = 'session-2';
    startSession(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION2,
      startedAt: '2026-05-21T02:00:00.000Z',
    });

    let threw = false;
    try {
      withTransaction(db, (txnDb) => {
        closeSessionGracefully(txnDb, {
          campaignId: CAMPAIGN,
          sessionId: SESSION2,
          closedAt: '2026-05-21T03:00:00.000Z',
          recap: 'Arc stamp rollback test.',
          stateDelta: [],
          arcStamp: { arcId: 'arc-99' },
        });
        throw new Error('simulated outer abort');
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    const row2 = db
      .prepare(
        `SELECT arc_id, status FROM campaign_session
         WHERE campaign_id = ? AND session_id = ?`,
      )
      .get(CAMPAIGN, SESSION2) as
      | { arc_id: string | null; status: string }
      | undefined;

    // Session is still open and arc_id is NULL — the outer abort rolled back both.
    expect(row2?.status).toBe('open');
    expect(row2?.arc_id).toBeNull();
    db.close();
  });
});
