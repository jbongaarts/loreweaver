import { describe, expect, it } from 'vitest';
import {
  initSchema,
  getSessionRecap,
  getArcSummary,
  getCampaignBible,
  listSceneSummaries,
  memoryDrilldown,
  openDatabase,
  recordSceneSummary,
  selectAlwaysOnMemory,
  rollupArcSummary,
  rollupSessionRecap,
} from '../src/index.js';

describe('memory summaries', () => {
  it('records incremental scene summaries with salient state references', () => {
    const db = openDatabase(':memory:');
    initSchema(db);

    recordSceneSummary(db, {
      campaignId: 'campaign-1',
      sessionId: 'session-1',
      sceneId: 'scene-1',
      summary: 'Mira finds fresh tracks in the ruined shrine.',
      salientRefs: [
        { target: 'plot_flags', field: 'found_shrine_tracks' },
        { target: 'overlay_facts', field: 'goblin_tracks' },
      ],
      sourceTurnIds: ['turn-1', 'turn-2'],
      createdAt: '2026-05-19T05:10:00.000Z',
      updatedAt: '2026-05-19T05:12:00.000Z',
    });
    recordSceneSummary(db, {
      campaignId: 'campaign-1',
      sessionId: 'session-1',
      sceneId: 'scene-2',
      summary: 'The old road warden warns Mira about the north road.',
      salientRefs: [{ target: 'character', field: 'name' }],
      sourceTurnIds: ['turn-3'],
      createdAt: '2026-05-19T05:20:00.000Z',
      updatedAt: '2026-05-19T05:20:00.000Z',
    });

    expect(
      listSceneSummaries(db, {
        campaignId: 'campaign-1',
        sessionId: 'session-1',
      }),
    ).toEqual([
      {
        campaignId: 'campaign-1',
        sessionId: 'session-1',
        sceneId: 'scene-1',
        summary: 'Mira finds fresh tracks in the ruined shrine.',
        salientRefs: [
          { target: 'plot_flags', field: 'found_shrine_tracks' },
          { target: 'overlay_facts', field: 'goblin_tracks' },
        ],
        sourceTurnIds: ['turn-1', 'turn-2'],
        createdAt: '2026-05-19T05:10:00.000Z',
        updatedAt: '2026-05-19T05:12:00.000Z',
      },
      {
        campaignId: 'campaign-1',
        sessionId: 'session-1',
        sceneId: 'scene-2',
        summary: 'The old road warden warns Mira about the north road.',
        salientRefs: [{ target: 'character', field: 'name' }],
        sourceTurnIds: ['turn-3'],
        createdAt: '2026-05-19T05:20:00.000Z',
        updatedAt: '2026-05-19T05:20:00.000Z',
      },
    ]);

    db.close();
  });

  it('rolls scene summaries and state deltas into an idempotent session recap', () => {
    const db = openDatabase(':memory:');
    initSchema(db);

    recordSceneSummary(db, {
      campaignId: 'campaign-1',
      sessionId: 'session-1',
      sceneId: 'scene-1',
      summary: 'Mira finds fresh tracks in the ruined shrine.',
      salientRefs: [{ target: 'plot_flags', field: 'found_shrine_tracks' }],
      sourceTurnIds: ['turn-1'],
      createdAt: '2026-05-19T05:10:00.000Z',
      updatedAt: '2026-05-19T05:10:00.000Z',
    });
    recordSceneSummary(db, {
      campaignId: 'campaign-1',
      sessionId: 'session-1',
      sceneId: 'scene-2',
      summary: 'The warden warns Mira about the north road.',
      salientRefs: [{ target: 'overlay_facts', field: 'goblin_tracks' }],
      sourceTurnIds: ['turn-2'],
      createdAt: '2026-05-19T05:20:00.000Z',
      updatedAt: '2026-05-19T05:20:00.000Z',
    });

    const input = {
      campaignId: 'campaign-1',
      sessionId: 'session-1',
      recap: 'Mira investigates the ruined shrine and learns the north road is dangerous.',
      stateDelta: [
        {
          target: 'plot_flags',
          field: 'found_shrine_tracks',
          op: 'set',
          value: true,
        },
      ],
      createdAt: '2026-05-19T06:00:00.000Z',
    } as const;

    rollupSessionRecap(db, input);
    rollupSessionRecap(db, input);

    expect(
      getSessionRecap(db, {
        campaignId: 'campaign-1',
        sessionId: 'session-1',
      }),
    ).toEqual({
      campaignId: 'campaign-1',
      sessionId: 'session-1',
      recap:
        'Mira investigates the ruined shrine and learns the north road is dangerous.',
      sourceSceneIds: ['scene-1', 'scene-2'],
      stateDelta: [
        {
          target: 'plot_flags',
          field: 'found_shrine_tracks',
          op: 'set',
          value: true,
        },
      ],
      createdAt: '2026-05-19T06:00:00.000Z',
      updatedAt: '2026-05-19T06:00:00.000Z',
    });

    const rows = db.prepare('SELECT COUNT(*) AS count FROM session_recap').get() as {
      count: number;
    };
    expect(rows.count).toBe(1);

    db.close();
  });

  it('rolls session recaps into an arc summary and reconciles the campaign bible', () => {
    const db = openDatabase(':memory:');
    initSchema(db);

    for (const [sessionId, sceneId, summary, recap] of [
      [
        'session-1',
        'scene-1',
        'Mira finds fresh tracks in the ruined shrine.',
        'Mira finds tracks and commits to following them north.',
      ],
      [
        'session-2',
        'scene-2',
        'Mira bargains with the road warden.',
        'The warden becomes a cautious ally and names the Ash Ford.',
      ],
    ] as const) {
      recordSceneSummary(db, {
        campaignId: 'campaign-1',
        sessionId,
        sceneId,
        summary,
        salientRefs: [{ target: 'plot_flags', field: `${sessionId}_flag` }],
        sourceTurnIds: [`${sessionId}-turn-1`],
        createdAt: '2026-05-19T05:10:00.000Z',
        updatedAt: '2026-05-19T05:10:00.000Z',
      });
      rollupSessionRecap(db, {
        campaignId: 'campaign-1',
        sessionId,
        recap,
        stateDelta: [{ target: 'plot_flags', field: `${sessionId}_flag` }],
        createdAt: '2026-05-19T06:00:00.000Z',
      });
    }

    const input = {
      campaignId: 'campaign-1',
      arcId: 'arc-1',
      summary: 'Mira follows shrine tracks north and gains the road warden as an ally.',
      sourceSessionIds: ['session-1', 'session-2'],
      campaignBible: {
        worldFacts: ['The Ash Ford lies north of the ruined shrine.'],
        majorNpcs: ['The old road warden is a cautious ally.'],
        factions: ['Goblin raiders are active near the north road.'],
        openThreads: ['Find who left the shrine tracks.'],
      },
      createdAt: '2026-05-19T07:00:00.000Z',
    } as const;

    rollupArcSummary(db, input);
    rollupArcSummary(db, input);

    expect(getArcSummary(db, { campaignId: 'campaign-1', arcId: 'arc-1' })).toEqual({
      campaignId: 'campaign-1',
      arcId: 'arc-1',
      summary:
        'Mira follows shrine tracks north and gains the road warden as an ally.',
      sourceSessionIds: ['session-1', 'session-2'],
      createdAt: '2026-05-19T07:00:00.000Z',
      updatedAt: '2026-05-19T07:00:00.000Z',
    });
    expect(getCampaignBible(db, { campaignId: 'campaign-1' })).toEqual({
      campaignId: 'campaign-1',
      worldFacts: [
        {
          text: 'The Ash Ford lies north of the ruined shrine.',
          sourceArcIds: ['arc-1'],
          sourceSessionIds: ['session-1', 'session-2'],
        },
      ],
      majorNpcs: [
        {
          text: 'The old road warden is a cautious ally.',
          sourceArcIds: ['arc-1'],
          sourceSessionIds: ['session-1', 'session-2'],
        },
      ],
      factions: [
        {
          text: 'Goblin raiders are active near the north road.',
          sourceArcIds: ['arc-1'],
          sourceSessionIds: ['session-1', 'session-2'],
        },
      ],
      openThreads: [
        {
          text: 'Find who left the shrine tracks.',
          sourceArcIds: ['arc-1'],
          sourceSessionIds: ['session-1', 'session-2'],
        },
      ],
      updatedAt: '2026-05-19T07:00:00.000Z',
    });

    const arcRows = db.prepare('SELECT COUNT(*) AS count FROM arc_summary').get() as {
      count: number;
    };
    const bibleRows = db
      .prepare('SELECT COUNT(*) AS count FROM campaign_bible')
      .get() as { count: number };
    expect(arcRows.count).toBe(1);
    expect(bibleRows.count).toBe(1);

    db.close();
  });

  it('drills down to a specific memory slice without mutating always-on memory', () => {
    const db = openDatabase(':memory:');
    initSchema(db);

    recordSceneSummary(db, {
      campaignId: 'campaign-1',
      sessionId: 'session-1',
      sceneId: 'scene-1',
      summary: 'Mira studies the shrine tracks.',
      salientRefs: [{ target: 'plot_flags', field: 'found_shrine_tracks' }],
      sourceTurnIds: ['turn-1'],
      createdAt: '2026-05-19T05:10:00.000Z',
      updatedAt: '2026-05-19T05:10:00.000Z',
    });
    rollupSessionRecap(db, {
      campaignId: 'campaign-1',
      sessionId: 'session-1',
      recap: 'Mira follows tracks from the shrine.',
      stateDelta: [{ target: 'plot_flags', field: 'found_shrine_tracks' }],
      createdAt: '2026-05-19T06:00:00.000Z',
    });
    rollupArcSummary(db, {
      campaignId: 'campaign-1',
      arcId: 'arc-1',
      summary: 'Mira pursues the shrine trail north.',
      sourceSessionIds: ['session-1'],
      campaignBible: {
        worldFacts: ['The trail leads north.'],
        majorNpcs: [],
        factions: [],
        openThreads: ['Find who left the tracks.'],
      },
      createdAt: '2026-05-19T07:00:00.000Z',
    });

    const beforeBible = getCampaignBible(db, { campaignId: 'campaign-1' });

    expect(
      memoryDrilldown(db, {
        target: 'scene',
        campaignId: 'campaign-1',
        sessionId: 'session-1',
        sceneId: 'scene-1',
      }),
    ).toEqual({
      target: 'scene',
      record: {
        campaignId: 'campaign-1',
        sessionId: 'session-1',
        sceneId: 'scene-1',
        summary: 'Mira studies the shrine tracks.',
        salientRefs: [{ target: 'plot_flags', field: 'found_shrine_tracks' }],
        sourceTurnIds: ['turn-1'],
        createdAt: '2026-05-19T05:10:00.000Z',
        updatedAt: '2026-05-19T05:10:00.000Z',
      },
    });
    expect(
      memoryDrilldown(db, {
        target: 'session',
        campaignId: 'campaign-1',
        sessionId: 'session-1',
      })?.target,
    ).toBe('session');
    expect(
      memoryDrilldown(db, {
        target: 'arc',
        campaignId: 'campaign-1',
        arcId: 'arc-1',
      })?.target,
    ).toBe('arc');

    expect(getCampaignBible(db, { campaignId: 'campaign-1' })).toEqual(beforeBible);

    db.close();
  });

  it('keeps always-on memory bounded as session count grows', () => {
    const db = openDatabase(':memory:');
    initSchema(db);

    for (let i = 1; i <= 6; i += 1) {
      const sessionId = `session-${i}`;
      recordSceneSummary(db, {
        campaignId: 'campaign-1',
        sessionId,
        sceneId: `scene-${i}`,
        summary: `Scene summary ${i}`,
        salientRefs: [{ target: 'plot_flags', field: `flag_${i}` }],
        sourceTurnIds: [`turn-${i}`],
        createdAt: `2026-05-19T05:0${i}:00.000Z`,
        updatedAt: `2026-05-19T05:0${i}:00.000Z`,
      });
      rollupSessionRecap(db, {
        campaignId: 'campaign-1',
        sessionId,
        recap: `Session recap ${i}`,
        stateDelta: [{ target: 'plot_flags', field: `flag_${i}` }],
        createdAt: `2026-05-19T06:0${i}:00.000Z`,
      });
    }
    rollupArcSummary(db, {
      campaignId: 'campaign-1',
      arcId: 'arc-1',
      summary: 'The first arc summary.',
      sourceSessionIds: ['session-1', 'session-2', 'session-3'],
      campaignBible: {
        worldFacts: ['The north road is dangerous.'],
        majorNpcs: ['The road warden is an ally.'],
        factions: [],
        openThreads: ['Find the source of the tracks.'],
      },
      createdAt: '2026-05-19T07:00:00.000Z',
    });

    expect(
      selectAlwaysOnMemory(db, {
        campaignId: 'campaign-1',
        recentSessionLimit: 2,
      }),
    ).toEqual({
      campaignId: 'campaign-1',
      campaignBible: getCampaignBible(db, { campaignId: 'campaign-1' }),
      recentSessionRecaps: [
        getSessionRecap(db, {
          campaignId: 'campaign-1',
          sessionId: 'session-5',
        }),
        getSessionRecap(db, {
          campaignId: 'campaign-1',
          sessionId: 'session-6',
        }),
      ],
      omittedSessionCount: 4,
      drilldownAvailable: true,
    });

    db.close();
  });
});
