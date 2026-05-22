import { describe, expect, it } from 'vitest';
import {
  appendSceneLog,
  closeSessionGracefully,
  getArcSummary,
  getCampaignBible,
  getOpenScene,
  getOpenSession,
  getSession,
  getSessionRecap,
  listSceneSummaries,
  openScene,
  startSession,
} from '../src/index.js';
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
      arcRollup: {
        arcId: 'arc-1',
        summary: 'The road north becomes the active lead.',
        campaignBible: {
          worldFacts: ['A chalk sigil on the old mile marker points north.'],
          majorNpcs: [],
          factions: [],
          openThreads: ['Follow the sigil north.'],
        },
      },
    });

    expect(result.session.status).toBe('closed');
    expect(result.closedSceneIds).toEqual(['scene-1']);
    expect(result.checkpointId).toBe('checkpoint-1');
    expect(getOpenSession(db, { campaignId: CAMPAIGN })).toBeUndefined();
    expect(getOpenScene(db, { campaignId: CAMPAIGN, sessionId: SESSION }))
      .toBeUndefined();
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
    expect(getArcSummary(db, { campaignId: CAMPAIGN, arcId: 'arc-1' })?.summary)
      .toBe('The road north becomes the active lead.');
    expect(getCampaignBible(db, { campaignId: CAMPAIGN })?.worldFacts[0]?.text)
      .toBe('A chalk sigil on the old mile marker points north.');
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
    expect(listSceneSummaries(db, { campaignId: CAMPAIGN, sessionId: SESSION }))
      .toHaveLength(1);
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

  it('rolls back scene close, summaries, recap, and session close when a rollup fails', () => {
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

    expect(() =>
      closeSessionGracefully(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        closedAt: '2026-05-21T01:00:00.000Z',
        recap: 'The road bends north.',
        stateDelta: [],
        arcRollup: {
          arcId: 'arc-1',
          summary: 'Invalid campaign bible payload.',
          campaignBible: {
            worldFacts: [1n as unknown as string],
            majorNpcs: [],
            factions: [],
            openThreads: [],
          },
        },
      }),
    ).toThrow();

    expect(getSession(db, { campaignId: CAMPAIGN, sessionId: SESSION })?.status)
      .toBe('open');
    expect(getOpenSession(db, { campaignId: CAMPAIGN })?.sessionId).toBe(
      SESSION,
    );
    expect(getOpenScene(db, { campaignId: CAMPAIGN, sessionId: SESSION })
      ?.sceneId).toBe('scene-1');
    expect(
      listSceneSummaries(db, { campaignId: CAMPAIGN, sessionId: SESSION }),
    ).toEqual([]);
    expect(
      getSessionRecap(db, { campaignId: CAMPAIGN, sessionId: SESSION }),
    ).toBeUndefined();
    expect(getArcSummary(db, { campaignId: CAMPAIGN, arcId: 'arc-1' }))
      .toBeUndefined();
    expect(getCampaignBible(db, { campaignId: CAMPAIGN })).toBeUndefined();
    db.close();
  });
});
