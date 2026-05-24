import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createCampaign,
  createDefaultToolRegistry,
  DND5E_SRD_RULES_PACK,
  DoltRepo,
  EMBERFALL_HOLLOW,
  getArcSummary,
  getCampaign,
  getCampaignBible,
  getOpenSession,
  getSession,
  getSessionRecap,
  initSchema,
  listSessions,
  ModelClientError,
  openDatabase,
  readCampaignRulesBinding,
  startSession,
  type Db,
  type ModelClient,
  type RunTurnInput,
  type RunTurnResult,
} from '@loreweaver/core';
import {
  appendSceneLog,
  assembleContext,
  DEFAULT_MEMORY_CONFIG,
  getOpenScene,
  openScene,
  recordTurnTrace,
  renderContextMessage,
} from '@loreweaver/core/internal';
import {
  doltCheckpointRunner,
  runDemo,
  runPlay,
  type CliIO,
  type PlayDeps,
} from '../src/play.js';

const FAKE_ARC_SUMMARY = 'FAKE_ARC_SUMMARY';

const ROUTED_FAKE_BIBLE_JSON =
  '```bible_json\n' +
  '{"worldFacts":["Emberfall sits on a fault line"],"majorNpcs":["Mira the runesmith"],"factions":["Lantern Court"],"openThreads":["The chalk sigil is unsolved"]}\n' +
  '```';

function routedFakeModel(routes: {
  bible: () => string | Promise<string>;
  summary: () => string | Promise<string>;
}): ModelClient {
  return {
    complete: async (input) => {
      if (input.system?.includes('extract structured world facts')) {
        return routes.bible();
      }
      return routes.summary();
    },
  };
}

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

const VALID_CHARACTER_ANSWERS = [
  'Mira',
  'Human',
  'Fighter',
  'point_buy',
  '15',
  '14',
  '14',
  '10',
  '10',
  '8',
  '12',
  '',
] as const;

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
  makeCheckpointRunner: PlayDeps['makeCheckpointRunner'] = () => undefined,
): PlayDeps {
  let ids = 0;
  let clock = 0;
  return {
    io,
    openDb: () => db,
    model: routedFakeModel({
      bible: () => ROUTED_FAKE_BIBLE_JSON,
      summary: () => FAKE_ARC_SUMMARY,
    }),
    registry: createDefaultToolRegistry(),
    runTurn,
    pack: EMBERFALL_HOLLOW,
    now: () =>
      new Date(Date.UTC(2026, 4, 20, 0, 0, clock++)).toISOString(),
    nextId: (prefix) => `${prefix}-${++ids}`,
    seed: () => 1,
    makeCheckpointRunner,
    memoryConfig: { ...DEFAULT_MEMORY_CONFIG },
  };
}

describe('runPlay', () => {
  it('creates a campaign, plays turns, and graceful-exits through the close pipeline', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO([
      ...VALID_CHARACTER_ANSWERS,
      'look around',
      'open the door',
      '/quit',
    ]);

    const code = await runPlay(baseDeps(db, io), { dbPath: 'demo.db' });

    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('Created campaign');
    expect(out).toContain('Character creation complete');
    expect(out).toContain(EMBERFALL_HOLLOW.meta.title);
    expect(out).toContain('Started session');
    expect(out).toContain('DM: you said "look around"');
    expect(out).toContain('DM: you said "open the door"');
    expect(out).toContain('closed and recapped');

    // Graceful exit ran the close pipeline: session closed, recap written
    // with content drawn from played scene narration (not a factual stub).
    const session = listSessions(db, { campaignId: campaignId(db) })[0];
    expect(getOpenSession(db, { campaignId: campaignId(db) })).toBeUndefined();
    const recap = getSessionRecap(db, {
      campaignId: campaignId(db),
      sessionId: session.sessionId,
    });
    expect(recap).toBeDefined();
    expect(recap?.recap).toContain('DM: you said "look around"');
    expect(recap?.recap).toContain('DM: you said "open the door"');
    expect(recap?.sourceSceneIds.length).toBeGreaterThan(0);
    expect(
      db
        .prepare('SELECT name, class_name, hp_max FROM character WHERE id = 1')
        .get(),
    ).toEqual({ name: 'Mira', class_name: 'Fighter', hp_max: 12 });

    // The unmanaged play-time campaign created above persists the default
    // D&D SRD rules binding — runPlay relies on the DB binding/defaulting, not
    // any external registry metadata, for system identity.
    const binding = readCampaignRulesBinding(db);
    expect(binding?.base.systemId).toBe(DND5E_SRD_RULES_PACK.meta.systemId);
    expect(binding?.base.packId).toBe(DND5E_SRD_RULES_PACK.meta.packId);

    dispose();
  });

  it('persists recap content the next session can read via assembleContext', async () => {
    // The bead acceptance is that a closed session's recap is tied to played
    // content AND that later sessions surface it through context assembly.
    const { db, dispose } = makeDb();
    const { io } = scriptedIO([
      '/defer',
      'look around',
      'open the door',
      '/quit',
    ]);
    await runPlay(baseDeps(db, io), { dbPath: 'demo.db' });

    const cid = campaignId(db);
    // Stage a fresh session as if the player re-opened the campaign next time.
    startSession(db, {
      campaignId: cid,
      sessionId: 'next-session',
      startedAt: '2026-05-21T00:00:00.000Z',
    });

    const ctx = assembleContext({
      db,
      campaignId: cid,
      sessionId: 'next-session',
      playerInput: 'I think back to last time…',
    });

    // The prior session's real narration carries forward — not a stub recap.
    expect(ctx.recentSessionRecaps.length).toBe(1);
    expect(ctx.recentSessionRecaps[0]?.recap).toContain(
      'DM: you said "look around"',
    );
    expect(ctx.recentSessionRecaps[0]?.recap).toContain(
      'DM: you said "open the door"',
    );
    // The rendered context the DM model sees mentions the carried narration.
    const rendered = renderContextMessage(ctx);
    expect(rendered).toContain('## Recent Sessions');
    expect(rendered).toContain('DM: you said "look around"');
    dispose();
  });

  it('rolls accepted state deltas from turn traces into the session recap', async () => {
    // The bead acceptance also requires accepted-mutation continuity. The
    // orchestrator writes a turn_trace per turn; the close composer aggregates
    // their acceptedStateDelta into the recap's stateDelta column. We bypass
    // the live orchestrator here by recording traces inline from a fake turn.
    const { db, dispose } = makeDb();
    const traceTurn = async (
      deps: { db: Db },
      input: RunTurnInput,
    ): Promise<RunTurnResult> => {
      const result = await fakeRunTurn(deps, input);
      recordTurnTrace(deps.db, {
        campaignId: input.campaignId,
        sessionId: input.sessionId,
        turnId: input.turnId,
        consentScope: 'private',
        playerInput: input.playerInput,
        retrievedContext: [],
        promptProfile: 'premium_dm',
        modelOutput: result.narration,
        toolCalls: [],
        rulesResolution: null,
        acceptedStateDelta: [
          {
            target: 'plot_flags',
            field: `seen-${input.turnId}`,
            op: 'set',
            value: true,
          },
        ],
        rejectedCandidates: [],
        finalNarration: result.narration,
        memoryUpdates: [],
        humanCorrections: [],
        qualityFlags: [],
        createdAt: input.at,
      });
      return result;
    };

    await runPlay(
      baseDeps(
        db,
        scriptedIO(['/defer', 'poke the lever', '/quit']).io,
        traceTurn,
      ),
      { dbPath: 'demo.db' },
    );

    const cid = campaignId(db);
    const session = listSessions(db, { campaignId: cid })[0];
    const recap = getSessionRecap(db, {
      campaignId: cid,
      sessionId: session.sessionId,
    });
    expect(recap?.stateDelta).toHaveLength(1);
    expect(recap?.stateDelta[0]).toMatchObject({
      target: 'plot_flags',
      op: 'set',
      value: true,
    });
    dispose();
  });

  it('rejects an invalid character draft and prompts again before starting turns', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO([
      'Mira',
      'Human',
      'Warlock',
      'point_buy',
      '15',
      '14',
      '14',
      '10',
      '10',
      '8',
      '12',
      '',
      ...VALID_CHARACTER_ANSWERS,
      'look around',
      '/quit',
    ]);

    const code = await runPlay(baseDeps(db, io), { dbPath: 'demo.db' });

    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('unsupported SRD class: Warlock');
    expect(out).toContain('Character creation complete');
    expect(out).toContain('DM: you said "look around"');
    expect(
      db.prepare('SELECT name, class_name FROM character WHERE id = 1').get(),
    ).toEqual({ name: 'Mira', class_name: 'Fighter' });
    dispose();
  });

  it('does not start a session when input ends before character creation is accepted', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO([]);

    const code = await runPlay(baseDeps(db, io), { dbPath: 'demo.db' });

    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('Character creation required');
    expect(getOpenSession(db, { campaignId: campaignId(db) })).toBeUndefined();
    dispose();
  });

  it('allows play only through the explicit character creation deferral path', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO(['/defer', 'look around', '/quit']);

    const code = await runPlay(baseDeps(db, io), { dbPath: 'demo.db' });

    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('Character creation deferred');
    expect(out).toContain('DM: you said "look around"');
    expect(
      db.prepare('SELECT name, class_name FROM character WHERE id = 1').get(),
    ).toEqual({ name: null, class_name: null });
    dispose();
  });

  it('rolls the campaign arc up after a session closes', async () => {
    const { db, dispose } = makeDb();
    const { io } = scriptedIO(['/defer', 'look around', '/quit']);

    await runPlay(baseDeps(db, io), { dbPath: 'demo.db' });

    const cid = campaignId(db);
    const arc = getArcSummary(db, { campaignId: cid, arcId: 'arc-1' });
    expect(arc).toBeDefined();
    const session = listSessions(db, { campaignId: cid })[0];
    expect(arc?.sourceSessionIds).toContain(session.sessionId);
    // The CLI close pipeline now hands the recap list to composeArcSummary, so
    // arc.summary is exactly what the (fake) model returned — not a mechanical
    // join of recap text.
    expect(arc?.summary).toBe(FAKE_ARC_SUMMARY);

    // The extracted bible from the routed fake model now lands in
    // campaign_bible. Each entry is wrapped by reconcileBibleEntries.
    const bible = getCampaignBible(db, { campaignId: cid });
    expect(bible).toBeDefined();
    expect(bible?.worldFacts.map((e) => e.text)).toContain(
      'Emberfall sits on a fault line',
    );
    expect(bible?.majorNpcs.map((e) => e.text)).toContain('Mira the runesmith');
    expect(bible?.factions.map((e) => e.text)).toContain('Lantern Court');
    expect(bible?.openThreads.map((e) => e.text)).toContain(
      'The chalk sigil is unsolved',
    );
    dispose();
  });

  it('skips arc rollup and warns when the model errors during close', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO(['/defer', 'look around', '/quit']);
    const deps: PlayDeps = {
      ...baseDeps(db, io),
      model: {
        complete: async () => {
          throw new ModelClientError('provider down');
        },
      },
    };

    const code = await runPlay(deps, { dbPath: 'demo.db' });

    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('closed and recapped');
    expect(out).toContain('Arc rollup skipped (bible extraction failed): provider down.');

    const cid = campaignId(db);
    // Session closed and recap written despite the model error.
    const session = listSessions(db, { campaignId: cid })[0];
    expect(getOpenSession(db, { campaignId: cid })).toBeUndefined();
    const recap = getSessionRecap(db, {
      campaignId: cid,
      sessionId: session.sessionId,
    });
    expect(recap).toBeDefined();
    // arc_summary row was NOT written because the model call failed before the
    // rollupArcSummary write.
    expect(getArcSummary(db, { campaignId: cid, arcId: 'arc-1' })).toBeUndefined();
    dispose();
  });

  it('retries the bible call once and recovers when the second attempt succeeds', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO(['/defer', 'look around', '/quit']);
    let bibleCallCount = 0;
    const deps: PlayDeps = {
      ...baseDeps(db, io),
      model: routedFakeModel({
        bible: () => {
          bibleCallCount++;
          if (bibleCallCount === 1) {
            throw new ModelClientError('first attempt fails');
          }
          return ROUTED_FAKE_BIBLE_JSON;
        },
        summary: () => FAKE_ARC_SUMMARY,
      }),
    };

    const code = await runPlay(deps, { dbPath: 'demo.db' });

    expect(code).toBe(0);
    expect(bibleCallCount).toBe(2);
    const out = lines.join('\n');
    expect(out).toContain('closed and recapped');
    // Retry succeeded silently: no skip warning written.
    expect(out).not.toContain('Arc rollup skipped');

    const cid = campaignId(db);
    const arc = getArcSummary(db, { campaignId: cid, arcId: 'arc-1' });
    expect(arc?.summary).toBe(FAKE_ARC_SUMMARY);
    const bible = getCampaignBible(db, { campaignId: cid });
    expect(bible?.worldFacts.map((e) => e.text)).toContain(
      'Emberfall sits on a fault line',
    );
    dispose();
  });

  it('skips the rollup and warns when bible extraction fails twice', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO(['/defer', 'look around', '/quit']);
    const deps: PlayDeps = {
      ...baseDeps(db, io),
      model: routedFakeModel({
        bible: () => {
          throw new ModelClientError('bible provider down');
        },
        summary: () => FAKE_ARC_SUMMARY,
      }),
    };

    const code = await runPlay(deps, { dbPath: 'demo.db' });

    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('closed and recapped');
    expect(out).toContain(
      'Arc rollup skipped (bible extraction failed): bible provider down.',
    );

    const cid = campaignId(db);
    // Session closed and recap written despite the bible failure.
    expect(getOpenSession(db, { campaignId: cid })).toBeUndefined();
    const session = listSessions(db, { campaignId: cid })[0];
    expect(getSessionRecap(db, { campaignId: cid, sessionId: session.sessionId })).toBeDefined();
    // No arc_summary row was written because the bible call failed both attempts.
    expect(getArcSummary(db, { campaignId: cid, arcId: 'arc-1' })).toBeUndefined();
    dispose();
  });

  it('skips the rollup and warns when arc summary fails after bible succeeded', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO(['/defer', 'look around', '/quit']);
    const deps: PlayDeps = {
      ...baseDeps(db, io),
      model: routedFakeModel({
        bible: () => ROUTED_FAKE_BIBLE_JSON,
        summary: () => {
          throw new ModelClientError('summary provider down');
        },
      }),
    };

    const code = await runPlay(deps, { dbPath: 'demo.db' });

    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('closed and recapped');
    expect(out).toContain(
      'Arc rollup skipped (arc summary failed): summary provider down.',
    );

    const cid = campaignId(db);
    // No arc_summary row was written despite the bible succeeding — the
    // contract is atomic: both must succeed or neither writes.
    expect(getArcSummary(db, { campaignId: cid, arcId: 'arc-1' })).toBeUndefined();
    // Also no campaign_bible row, since rollupArcSummary is what writes it.
    expect(getCampaignBible(db, { campaignId: cid })).toBeUndefined();
    dispose();
  });

  it('quits gracefully when input ends (EOF) before any turn', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO(['/defer']); // EOF after launch.

    const code = await runPlay(baseDeps(db, io), { dbPath: 'demo.db' });

    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('closed and recapped');
    expect(getOpenSession(db, { campaignId: campaignId(db) })).toBeUndefined();
    dispose();
  });

  it('offers Resume for an open session and replays the scene tail', async () => {
    const { db, dispose } = makeDb();
    seedOpenSession(db);
    const { io, lines } = scriptedIO(['/defer', 'resume', '/quit']);

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
    const { io, lines } = scriptedIO(['/defer', 'close', '/quit']);

    await runPlay(baseDeps(db, io), { dbPath: 'demo.db' });

    expect(lines.join('\n')).toContain(
      'Session crashed-session closed and recapped',
    );
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
    const { io, lines } = scriptedIO(['/defer', 'risky move', '/quit']);
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

  it('checkpoints the campaign on graceful exit and reports the id', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO(['/defer', 'explore', '/quit']);
    const run = vi.fn((_liveDbPath: string, message: string) => {
      expect(message).toContain('session');
      return 'checkpoint-abc123';
    });

    const code = await runPlay(
      baseDeps(db, io, fakeRunTurn, (dbPath) => ({ liveDbPath: dbPath, run })),
      { dbPath: 'campaign.db' },
    );

    expect(code).toBe(0);
    expect(run).toHaveBeenCalledOnce();
    // The runner is handed the actual campaign DB path to snapshot.
    expect(run.mock.calls[0][0]).toBe('campaign.db');
    expect(lines.join('\n')).toContain('(checkpoint checkpoint-abc123)');
    dispose();
  });

  it('closes gracefully without a checkpoint when Dolt is unavailable', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO(['/defer', '/quit']);

    await runPlay(baseDeps(db, io, fakeRunTurn, () => undefined), {
      dbPath: 'campaign.db',
    });

    const out = lines.join('\n');
    expect(out).toContain('closed and recapped');
    expect(out).toMatch(/Dolt is not available/i);
    expect(getOpenSession(db, { campaignId: campaignId(db) })).toBeUndefined();
    dispose();
  });

  it('still closes the session when the checkpoint itself fails', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO(['/defer', '/quit']);

    const code = await runPlay(
      baseDeps(db, io, fakeRunTurn, (dbPath) => ({
        liveDbPath: dbPath,
        run: () => {
          throw new Error('dolt exploded');
        },
      })),
      { dbPath: 'campaign.db' },
    );

    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('checkpoint failed');
    expect(out).toContain('dolt exploded');
    // The session is still closed — the close pipeline ran before the
    // checkpoint, so a checkpoint failure never strands an open session.
    expect(getOpenSession(db, { campaignId: campaignId(db) })).toBeUndefined();
    dispose();
  });
});

describe('runDemo', () => {
  it('creates a bounded demo campaign and stops at the turn cap', async () => {
    const { db, dispose } = makeDb();
    const { io, lines } = scriptedIO([
      'look around',
      'open the door',
      'third turn',
    ]);

    const code = await runDemo(baseDeps(db, io), {
      dbPath: 'demo.db',
      turnCap: 2,
    });

    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('Demo campaign');
    expect(out).toContain('Bounded demo: 2 turns');
    expect(out).toContain('DM: you said "look around"');
    expect(out).toContain('DM: you said "open the door"');
    // The cap stops the loop before the third input is ever read.
    expect(out).toContain('Demo turn cap reached (2/2)');
    expect(out).not.toContain('third turn');
    expect(out).toContain('closed and recapped');
    dispose();
  });

  it('reuses an existing demo campaign on a later run', async () => {
    const { db, dispose } = makeDb();
    const firstDeps = baseDeps(db, scriptedIO(['first turn']).io);
    // First run creates the demo campaign and plays one turn.
    await runDemo(firstDeps, {
      dbPath: 'demo.db',
      turnCap: 5,
    });

    // A second run on the same db reuses the campaign rather than recreating.
    const { io, lines } = scriptedIO(['/quit']);
    const code = await runDemo({ ...firstDeps, io }, {
      dbPath: 'demo.db',
      turnCap: 5,
    });

    expect(code).toBe(0);
    const out = lines.join('\n');
    expect(out).toContain('Demo campaign:'); // the "existing campaign" branch
    expect(out).not.toContain("Demo campaign '"); // not the "created" branch
    dispose();
  });
});

describe.skipIf(!DoltRepo.available())('runPlay Dolt checkpoint integration', () => {
  it('writes a real Dolt checkpoint of the campaign on graceful exit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lw-play-cp-'));
    const dbPath = join(root, 'campaign.db');
    const db = openDatabase(dbPath);
    initSchema(db);
    const { io, lines } = scriptedIO(['/defer', 'look around', '/quit']);

    const code = await runPlay(
      { ...baseDeps(db, io), makeCheckpointRunner: doltCheckpointRunner },
      { dbPath },
    );

    expect(code).toBe(0);
    // A real Dolt commit hash was produced and reported.
    expect(lines.join('\n')).toMatch(/\(checkpoint [0-9a-z]+\)/);
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
