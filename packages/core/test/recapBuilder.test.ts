import { describe, expect, it } from 'vitest';
import {
  appendSceneLog,
  closeScene,
  closeSession,
  composeSessionRecap,
  openScene,
  recordSceneSummary,
  recordTurnTrace,
  startSession,
  type TurnTraceRecord,
} from '../src/internal.js';
import {
  bareDb,
  DEFAULT_TEST_CAMPAIGN_ID,
  DEFAULT_TEST_SESSION_ID,
  freshDbWithSession,
} from './support/db.js';

const CAMPAIGN = DEFAULT_TEST_CAMPAIGN_ID;
const SESSION = DEFAULT_TEST_SESSION_ID;

function baseTrace(turnId: string): TurnTraceRecord {
  return {
    campaignId: CAMPAIGN,
    sessionId: SESSION,
    turnId,
    consentScope: 'private',
    playerInput: `do thing ${turnId}`,
    retrievedContext: [],
    promptProfile: 'premium_dm',
    modelOutput: 'narration',
    toolCalls: [],
    rulesResolution: null,
    acceptedStateDelta: [],
    rejectedCandidates: [],
    finalNarration: 'narration',
    memoryUpdates: [],
    humanCorrections: [],
    qualityFlags: [],
    createdAt: '2026-05-20T10:00:00.000Z',
  };
}

describe('composeSessionRecap', () => {
  it('joins closed scene summaries and the open scenes narration', () => {
    const db = freshDbWithSession();
    recordSceneSummary(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      summary: 'Mira finds a chalk sigil at the mile marker.',
      salientRefs: [],
      sourceTurnIds: ['turn-1'],
      createdAt: '2026-05-20T10:00:00.000Z',
      updatedAt: '2026-05-20T10:00:00.000Z',
    });
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-2',
      title: 'The Wayhouse',
      at: '2026-05-20T10:30:00.000Z',
    });
    appendSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-2',
      turnId: 'turn-2',
      role: 'player',
      content: 'I knock on the door.',
      at: '2026-05-20T10:31:00.000Z',
    });
    appendSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-2',
      turnId: 'turn-2',
      role: 'dm',
      content: 'The warden answers and ushers you in by the fire.',
      at: '2026-05-20T10:31:00.000Z',
    });

    const { recap, stateDelta } = composeSessionRecap(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
    });

    expect(recap).toBe(
      'Mira finds a chalk sigil at the mile marker. ' +
        'The warden answers and ushers you in by the fire.',
    );
    expect(stateDelta).toEqual([]);
    db.close();
  });

  it('aggregates acceptedStateDelta from all turn traces in turn order', () => {
    const db = freshDbWithSession();
    recordTurnTrace(db, {
      ...baseTrace('turn-1'),
      acceptedStateDelta: [
        { target: 'plot_flags', field: 'found_sigil', op: 'set', value: true },
      ],
      createdAt: '2026-05-20T10:00:00.000Z',
    });
    recordTurnTrace(db, {
      ...baseTrace('turn-2'),
      acceptedStateDelta: [
        {
          target: 'inventory',
          id: 'lantern',
          field: 'quantity',
          op: 'set',
          value: 1,
        },
      ],
      createdAt: '2026-05-20T10:05:00.000Z',
    });

    const { stateDelta } = composeSessionRecap(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
    });

    expect(stateDelta).toEqual([
      { target: 'plot_flags', field: 'found_sigil', op: 'set', value: true },
      {
        target: 'inventory',
        id: 'lantern',
        field: 'quantity',
        op: 'set',
        value: 1,
      },
    ]);
    db.close();
  });

  it('falls back to a non-empty recap when the session played no scenes', () => {
    const db = freshDbWithSession();

    const { recap, stateDelta } = composeSessionRecap(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
    });

    expect(recap).toBe('(session ended with no scenes played)');
    expect(stateDelta).toEqual([]);
    db.close();
  });

  it('falls back when the only scene closed with no DM narration', () => {
    const db = freshDbWithSession();
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'silent',
      title: 'Silence',
      at: '2026-05-20T10:00:00.000Z',
    });

    const { recap } = composeSessionRecap(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
    });

    expect(recap).toBe('(scene closed with no narration)');
    db.close();
  });

  it('ignores other sessions in the same campaign', () => {
    const db = bareDb();
    startSession(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-a',
      startedAt: '2026-05-20T09:00:00.000Z',
    });
    // Only one session per campaign may be open at a time; close A before B.
    closeSession(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-a',
      closedAt: '2026-05-20T10:30:00.000Z',
    });
    startSession(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-b',
      startedAt: '2026-05-20T11:00:00.000Z',
    });
    recordSceneSummary(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-a',
      sceneId: 'scene-a',
      summary: 'Played in session A.',
      salientRefs: [],
      sourceTurnIds: ['turn-a'],
      createdAt: '2026-05-20T10:00:00.000Z',
      updatedAt: '2026-05-20T10:00:00.000Z',
    });
    recordSceneSummary(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-b',
      sceneId: 'scene-b',
      summary: 'Played in session B.',
      salientRefs: [],
      sourceTurnIds: ['turn-b'],
      createdAt: '2026-05-20T11:30:00.000Z',
      updatedAt: '2026-05-20T11:30:00.000Z',
    });
    recordTurnTrace(db, {
      ...baseTrace('turn-a'),
      sessionId: 'session-a',
      acceptedStateDelta: [{ target: 'plot_flags', field: 'a' }],
      createdAt: '2026-05-20T10:00:00.000Z',
    });
    recordTurnTrace(db, {
      ...baseTrace('turn-b'),
      sessionId: 'session-b',
      acceptedStateDelta: [{ target: 'plot_flags', field: 'b' }],
      createdAt: '2026-05-20T11:30:00.000Z',
    });

    const a = composeSessionRecap(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-a',
    });
    const b = composeSessionRecap(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-b',
    });

    expect(a.recap).toBe('Played in session A.');
    expect(a.stateDelta).toEqual([{ target: 'plot_flags', field: 'a' }]);
    expect(b.recap).toBe('Played in session B.');
    expect(b.stateDelta).toEqual([{ target: 'plot_flags', field: 'b' }]);
    db.close();
  });

  it('includes closed-scene summaries even when the session has no open scene', () => {
    const db = freshDbWithSession();
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      title: 'Opening',
      at: '2026-05-20T10:00:00.000Z',
    });
    appendSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      turnId: 'turn-1',
      role: 'dm',
      content: 'You set out at dawn.',
      at: '2026-05-20T10:01:00.000Z',
    });
    closeScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      at: '2026-05-20T10:30:00.000Z',
    });
    recordSceneSummary(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-1',
      summary: 'You set out at dawn.',
      salientRefs: [],
      sourceTurnIds: ['turn-1'],
      createdAt: '2026-05-20T10:30:00.000Z',
      updatedAt: '2026-05-20T10:30:00.000Z',
    });

    const { recap } = composeSessionRecap(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
    });

    expect(recap).toBe('You set out at dawn.');
    db.close();
  });
});
