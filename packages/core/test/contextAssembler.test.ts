import { describe, expect, it } from 'vitest';
import {
  appendSceneLog,
  assembleContext,
  closeScene,
  initSchema,
  mutateState,
  openDatabase,
  openScene,
  recordSceneSummary,
  renderContextMessage,
  rollupArcSummary,
  rollupSessionRecap,
  startSession,
} from '../src/index.js';
import type { Db } from '../src/index.js';

const CAMPAIGN = 'campaign-1';
const SESSION = 'session-2';

function freshDb(): Db {
  const db = openDatabase(':memory:');
  initSchema(db);
  startSession(db, {
    campaignId: CAMPAIGN,
    sessionId: SESSION,
    startedAt: '2026-05-20T09:00:00.000Z',
  });
  return db;
}

function logTurn(
  db: Db,
  sceneId: string,
  turnId: string,
  player: string,
  dm: string,
): void {
  appendSceneLog(db, {
    campaignId: CAMPAIGN,
    sessionId: SESSION,
    sceneId,
    turnId,
    role: 'player',
    content: player,
    at: '2026-05-20T10:00:00.000Z',
  });
  appendSceneLog(db, {
    campaignId: CAMPAIGN,
    sessionId: SESSION,
    sceneId,
    turnId,
    role: 'dm',
    content: dm,
    at: '2026-05-20T10:00:01.000Z',
  });
}

describe('Context Assembler', () => {
  it('assembles only the bounded set and excludes older closed scenes', () => {
    const db = freshDb();

    // An older, closed scene — its transcript must NOT appear in context.
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-old',
      title: 'The Crypt',
      at: '2026-05-20T09:00:00.000Z',
    });
    logTurn(db, 'scene-old', 'turn-1', 'old player line', 'old dm line');
    closeScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-old',
      at: '2026-05-20T09:30:00.000Z',
    });

    // The current, open scene — its transcript is the live context.
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-now',
      title: 'The Tavern',
      at: '2026-05-20T10:00:00.000Z',
    });
    logTurn(db, 'scene-now', 'turn-2', 'I greet the barkeep.', 'He nods.');

    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'I ask about the missing caravan.',
    });

    expect(ctx.scene?.sceneId).toBe('scene-now');
    expect(ctx.sceneTranscript.map((e) => e.content)).toEqual([
      'I greet the barkeep.',
      'He nods.',
    ]);
    const joined = ctx.sceneTranscript.map((e) => e.content).join('\n');
    expect(joined).not.toContain('old player line');
    expect(ctx.playerInput).toBe('I ask about the missing caravan.');
    db.close();
  });

  it('snapshots full structured state', () => {
    const db = freshDb();
    mutateState(db, {
      target: 'character',
      field: 'name',
      op: 'set',
      value: 'Mira',
      provenance: 'test',
      sessionId: SESSION,
      at: '2026-05-20T10:00:00.000Z',
    });
    mutateState(db, {
      target: 'character',
      field: 'hp_current',
      op: 'set',
      value: 7,
      provenance: 'test',
      sessionId: SESSION,
      at: '2026-05-20T10:00:00.000Z',
    });
    mutateState(db, {
      target: 'inventory',
      id: 'sword-1',
      field: 'name',
      op: 'set',
      value: 'Iron Sword',
      provenance: 'test',
      sessionId: SESSION,
      at: '2026-05-20T10:00:00.000Z',
    });
    mutateState(db, {
      target: 'plot_flags',
      field: 'met_barkeep',
      op: 'set',
      value: true,
      provenance: 'test',
      sessionId: SESSION,
      at: '2026-05-20T10:00:00.000Z',
    });

    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'continue',
    });

    expect(ctx.state.character.name).toBe('Mira');
    expect(ctx.state.character.hpCurrent).toBe(7);
    expect(ctx.state.inventory.map((i) => i.name)).toContain('Iron Sword');
    expect(ctx.state.plotFlags.met_barkeep).toBe(true);
    db.close();
  });

  it('includes campaign bible, last session recap, and current arc', () => {
    const db = freshDb();
    rollupSessionRecap(db, {
      campaignId: CAMPAIGN,
      sessionId: 'session-1',
      recap: 'The party left the city gates.',
      stateDelta: [],
      createdAt: '2026-05-19T20:00:00.000Z',
    });
    rollupArcSummary(db, {
      campaignId: CAMPAIGN,
      arcId: 'arc-1',
      summary: 'The hunt for the lost caravan.',
      sourceSessionIds: ['session-1'],
      campaignBible: {
        worldFacts: ['The roads are dangerous.'],
        majorNpcs: ['Barkeep Tom'],
        factions: [],
        openThreads: ['Find the caravan'],
      },
      createdAt: '2026-05-19T21:00:00.000Z',
    });

    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      arcId: 'arc-1',
      playerInput: 'continue',
    });

    expect(ctx.campaignBible?.worldFacts[0].text).toBe(
      'The roads are dangerous.',
    );
    expect(ctx.arcSummary?.summary).toBe('The hunt for the lost caravan.');
    expect(ctx.recentSessionRecaps.map((r) => r.recap)).toContain(
      'The party left the city gates.',
    );
    db.close();
  });

  it('reports drilldown availability when older sessions are omitted', () => {
    const db = freshDb();
    for (const n of [1, 2, 3]) {
      rollupSessionRecap(db, {
        campaignId: CAMPAIGN,
        sessionId: `session-${n}`,
        recap: `Session ${n} happened.`,
        stateDelta: [],
        createdAt: `2026-05-1${n}T20:00:00.000Z`,
      });
    }
    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'continue',
      recentSessionLimit: 1,
    });
    expect(ctx.recentSessionRecaps).toHaveLength(1);
    expect(ctx.omittedSessionCount).toBe(2);
    expect(ctx.drilldownAvailable).toBe(true);
    db.close();
  });

  it('works against an empty campaign', () => {
    const db = freshDb();
    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'hello',
    });
    expect(ctx.campaignBible).toBeUndefined();
    expect(ctx.scene).toBeUndefined();
    expect(ctx.sceneTranscript).toEqual([]);
    expect(renderContextMessage(ctx)).toContain('hello');
    db.close();
  });

  it('renders a prompt message containing the bounded slices', () => {
    const db = freshDb();
    recordSceneSummary(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-x',
      summary: 'irrelevant',
      salientRefs: [],
      sourceTurnIds: [],
      createdAt: '2026-05-20T09:00:00.000Z',
      updatedAt: '2026-05-20T09:00:00.000Z',
    });
    openScene(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-now',
      title: 'The Tavern',
      at: '2026-05-20T10:00:00.000Z',
    });
    logTurn(db, 'scene-now', 'turn-1', 'I sit down.', 'The fire crackles.');

    const ctx = assembleContext({
      db,
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      playerInput: 'I order food.',
    });
    const message = renderContextMessage(ctx);
    expect(message).toContain('The Tavern');
    expect(message).toContain('The fire crackles.');
    expect(message).toContain('I order food.');
    db.close();
  });
});
