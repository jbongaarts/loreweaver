import { describe, expect, it, vi } from 'vitest';
import {
  appendSceneLog,
  createCampaign,
  createDefaultToolRegistry,
  EMBERFALL_HOLLOW,
  getCampaign,
  getOpenScene,
  getOpenSession,
  getSession,
  getSessionRecap,
  initSchema,
  listSessions,
  openDatabase,
  openScene,
  startSession,
  type Db,
  type ModelClient,
  type RunTurnInput,
  type RunTurnResult,
} from '@loreweaver/core';
import { runPlay, type CliIO, type PlayDeps } from '../src/play.js';

/**
 * An in-memory database whose `close()` is a no-op, so a test can assert on
 * persisted state after `runPlay` returns (runPlay closes its db on exit).
 */
function makeDb(): { db: Db; dispose: () => void } {
  const real = openDatabase(':memory:');
  initSchema(real);
  const db = new Proxy(real, {
    get(target, prop) {
      if (prop === 'close') {
        return () => {};
      }
      const value = Reflect.get(target, prop) as unknown;
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  }) as unknown as Db;
  return { db, dispose: () => real.close() };
}

/** A scripted {@link CliIO}: prompts return queued answers, then EOF. */
function scriptedIO(answers: ReadonlyArray<string>): {
  io: CliIO;
  lines: string[];
} {
  const lines: string[] = [];
  let next = 0;
  return {
    lines,
    io: {
      write: (line) => lines.push(line),
      prompt: async () =>
        next < answers.length ? answers[next++] : undefined,
    },
  };
}

/**
 * A fake `runTurn` that exercises the orchestrator's observable contract
 * without a model: it opens a scene if none is open and appends the player +
 * DM lines, so scene-tail / resume behaviour is real.
 */
async function fakeRunTurn(
  deps: { db: Db },
  input: RunTurnInput,
): Promise<RunTurnResult> {
  let scene = getOpenScene(deps.db, {
    campaignId: input.campaignId,
    sessionId: input.sessionId,
  });
  if (scene === undefined) {
    scene = openScene(deps.db, {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      sceneId: `${input.sessionId}-scene-1`,
      title: 'Emberfall Square',
      at: input.at,
    });
  }
  const narration = `DM: you said "${input.playerInput}"`;
  for (const [role, content] of [
    ['player', input.playerInput],
    ['dm', narration],
  ] as const) {
    appendSceneLog(deps.db, {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      sceneId: scene.sceneId,
      turnId: input.turnId,
      role,
      content,
      at: input.at,
    });
  }
  return {
    ok: true,
    turnId: input.turnId,
    narration,
    toolCalls: [],
    sceneId: scene.sceneId,
    modelRounds: 1,
    error: undefined,
  };
}

function baseDeps(
  db: Db,
  io: CliIO,
  runTurn: PlayDeps['runTurn'] = fakeRunTurn,
): PlayDeps {
  let ids = 0;
  let clock = 0;
  return {
    io,
    openDb: () => db,
    model: { complete: async () => '' } satisfies ModelClient,
    registry: createDefaultToolRegistry(),
    runTurn,
    pack: EMBERFALL_HOLLOW,
    now: () =>
      new Date(Date.UTC(2026, 4, 20, 0, 0, clock++)).toISOString(),
    nextId: (prefix) => `${prefix}-${++ids}`,
    seed: () => 1,
  };
}

describe('runPlay', () => {
  it('creates a campaign, plays turns, and graceful-exits through the close pipeline', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO(['look around', 'open the door', '/quit']);

    const code = await runPlay(baseDeps(db, io), { dbPath: 'demo.db' });

    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('Created campaign');
    expect(out).toContain(EMBERFALL_HOLLOW.meta.title);
    expect(out).toContain('Started session');
    expect(out).toContain('DM: you said "look around"');
    expect(out).toContain('DM: you said "open the door"');
    expect(out).toContain('closed and recapped');

    // Graceful exit ran the close pipeline: session closed, recap written.
    const session = listSessions(db, { campaignId: campaignId(db) })[0];
    expect(getOpenSession(db, { campaignId: campaignId(db) })).toBeUndefined();
    expect(
      getSessionRecap(db, {
        campaignId: campaignId(db),
        sessionId: session.sessionId,
      }),
    ).toBeDefined();
    dispose();
  });

  it('quits gracefully when input ends (EOF) before any turn', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO([]); // prompt() immediately returns EOF

    const code = await runPlay(baseDeps(db, io), { dbPath: 'demo.db' });

    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('closed and recapped');
    expect(getOpenSession(db, { campaignId: campaignId(db) })).toBeUndefined();
    dispose();
  });

  it('offers Resume for an open session and replays the scene tail', async () => {
    const { db, dispose } = makeDb();
    seedOpenSession(db);
    const { io, lines } = scriptedIO(['resume', '/quit']);

    await runPlay(baseDeps(db, io), { dbPath: 'demo.db' });

    const out = lines.join('\n');
    expect(out).toContain('An unfinished session is open: crashed-session');
    expect(out).toContain('— Recent scene: Emberfall Square —');
    expect(out).toContain('player: search the rubble');
    expect(out).toContain('Resuming session crashed-session');
    dispose();
  });

  it('closes and recaps an open session when the player chooses close', async () => {
    const { db, dispose } = makeDb();
    seedOpenSession(db);
    const { io, lines } = scriptedIO(['close', '/quit']);

    await runPlay(baseDeps(db, io), { dbPath: 'demo.db' });

    expect(lines.join('\n')).toContain('Previous session closed and recapped');
    expect(
      getSession(db, { campaignId: 'camp', sessionId: 'crashed-session' })
        ?.status,
    ).toBe('closed');
    // A fresh session was started for continued play.
    expect(getOpenSession(db, { campaignId: 'camp' })?.sessionId).not.toBe(
      'crashed-session',
    );
    dispose();
  });

  it('reports a failed turn and keeps playing without applying it', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO(['risky move', '/quit']);
    const failingRunTurn = vi.fn(
      async (_deps: unknown, input: RunTurnInput): Promise<RunTurnResult> => ({
        ok: false,
        turnId: input.turnId,
        narration: '',
        toolCalls: [],
        sceneId: undefined,
        modelRounds: 0,
        error: 'model boom',
      }),
    );

    const code = await runPlay(
      baseDeps(db, io, failingRunTurn as unknown as PlayDeps['runTurn']),
      { dbPath: 'demo.db' },
    );

    expect(code).toBe(0);
    expect(failingRunTurn).toHaveBeenCalledOnce();
    const out = lines.join('\n');
    expect(out).toContain('could not be completed');
    expect(out).toContain('model boom');
    expect(out).toContain('closed and recapped');
    dispose();
  });
});

function campaignId(db: Db): string {
  const campaign = getCampaign(db);
  if (campaign === undefined) {
    throw new Error('expected a campaign to exist');
  }
  return campaign.campaignId;
}

/** Seed a campaign with an open session + open scene — i.e. a crashed run. */
function seedOpenSession(db: Db): void {
  createCampaign(db, { campaignId: 'camp', pack: EMBERFALL_HOLLOW });
  startSession(db, {
    campaignId: 'camp',
    sessionId: 'crashed-session',
    startedAt: '2026-05-19T00:00:00.000Z',
  });
  openScene(db, {
    campaignId: 'camp',
    sessionId: 'crashed-session',
    sceneId: 'scene-1',
    title: 'Emberfall Square',
    at: '2026-05-19T00:01:00.000Z',
  });
  appendSceneLog(db, {
    campaignId: 'camp',
    sessionId: 'crashed-session',
    sceneId: 'scene-1',
    turnId: 'turn-1',
    role: 'player',
    content: 'search the rubble',
    at: '2026-05-19T00:02:00.000Z',
  });
}
