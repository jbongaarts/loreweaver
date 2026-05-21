import { describe, expect, it } from 'vitest';
import {
  appendSceneLog,
  closeSessionGracefully,
  getArcSummary,
  getCampaignBible,
  getOpenScene,
  getOpenSession,
  getSessionRecap,
  initSchema,
  listSceneSummaries,
  openDatabase,
  openScene,
  startSession,
} from '../src/index.js';

const CAMPAIGN = 'campaign-1';
const SESSION = 'session-1';

function freshDb() {
  const db = openDatabase(':memory:');
  initSchema(db);
  return db;
}

describe('graceful session close pipeline', () => {
  it('closes the open scene, writes rollups, checkpoints, and marks the session closed', () => {
    const db = freshDb();
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
    const db = freshDb();
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
});
