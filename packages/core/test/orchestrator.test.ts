import { describe, expect, it } from 'vitest';
import {
  createDefaultToolRegistry,
  getTurnTrace,
  listSceneLog,
  mutateState,
  openScene,
  runTurn,
} from '../src/index.js';
import type { Db, ModelClient, ModelCompleteInput } from '../src/index.js';
import { freshDbWithSession } from './support/db.js';

const CAMPAIGN = 'campaign-1';
const SESSION = 'session-1';

/** A ModelClient that replays a fixed script of replies, one per call. */
class ScriptedModel implements ModelClient {
  private index = 0;
  readonly seen: ModelCompleteInput[] = [];
  constructor(private readonly replies: string[]) {}
  complete(input: ModelCompleteInput): Promise<string> {
    this.seen.push(input);
    const reply = this.replies[this.index] ?? '';
    this.index += 1;
    return Promise.resolve(reply);
  }
}

/** A ModelClient that always throws — simulates an SDK/model failure. */
class FailingModel implements ModelClient {
  complete(): Promise<string> {
    return Promise.reject(new Error('model unavailable'));
  }
}

function withOpenScene(db: Db): void {
  openScene(db, {
    campaignId: CAMPAIGN,
    sessionId: SESSION,
    sceneId: 'scene-0',
    title: 'The Tavern',
    at: '2026-05-20T09:00:00.000Z',
  });
}

const toolCall = (tool: string, args: unknown): string =>
  ['```tool_call', JSON.stringify({ tool, args }), '```'].join('\n');

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    campaignId: CAMPAIGN,
    sessionId: SESSION,
    turnId: 'turn-1',
    playerInput: 'I look around the tavern.',
    seed: 42,
    at: '2026-05-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('orchestrator turn loop', () => {
  it('runs a full turn: model called, tool executed, narration + scene_log', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new ScriptedModel([
      toolCall('roll', { dice: '1d20+2', reason: 'perception' }),
      'You scan the room. The barkeep meets your eye and nods.',
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    expect(result.narration).toContain('barkeep');
    expect(result.toolCalls.map((c) => c.tool)).toEqual(['roll']);
    expect(result.toolCalls[0].result.ok).toBe(true);

    const log = listSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: 'scene-0',
    });
    expect(log.map((e) => e.role)).toEqual(['player', 'dm']);
    expect(log[0].content).toBe('I look around the tavern.');

    const trace = getTurnTrace(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      turnId: 'turn-1',
    });
    expect(trace?.finalNarration).toContain('barkeep');
    db.close();
  });

  it('does not mutate canon when the model changes state in prose only', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new ScriptedModel([
      'A gleaming +1 longsword appears in your pack. You now have 500 gold.',
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    expect(result.toolCalls).toHaveLength(0);
    const inventory = db.prepare('SELECT COUNT(*) AS n FROM inventory').get() as {
      n: number;
    };
    expect(inventory.n).toBe(0);
    db.close();
  });

  it('mutates canon when the model uses the mutate_state tool', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new ScriptedModel([
      toolCall('mutate_state', {
        target: 'character',
        field: 'hp_current',
        op: 'set',
        value: 12,
      }),
      'You bandage your wounds and feel steadier.',
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    const row = db
      .prepare('SELECT hp_current FROM character WHERE id = 1')
      .get() as { hp_current: number };
    expect(row.hp_current).toBe(12);
    db.close();
  });

  it('feeds a structured tool error back to the model and still completes', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new ScriptedModel([
      toolCall('mutate_state', {
        target: 'character',
        field: 'not_a_field',
        op: 'set',
        value: 1,
      }),
      'You reconsider and simply step forward.',
    ]);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    expect(result.toolCalls[0].result.ok).toBe(false);
    // The second model call received the tool_result error.
    expect(model.seen).toHaveLength(2);
    expect(model.seen[1].messages.at(-1)?.content).toContain('tool_result');
    db.close();
  });

  it('leaves pre-turn state intact when the model fails', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    mutateState(db, {
      target: 'character',
      field: 'name',
      op: 'set',
      value: 'Mira',
      provenance: 'setup',
      sessionId: SESSION,
      at: '2026-05-20T09:00:00.000Z',
    });

    const result = await runTurn(
      { db, model: new FailingModel(), registry: createDefaultToolRegistry() },
      baseInput(),
    );

    expect(result.ok).toBe(false);
    const row = db
      .prepare('SELECT name FROM character WHERE id = 1')
      .get() as { name: string };
    expect(row.name).toBe('Mira');
    expect(
      listSceneLog(db, {
        campaignId: CAMPAIGN,
        sessionId: SESSION,
        sceneId: 'scene-0',
      }),
    ).toEqual([]);
    db.close();
  });

  it('rolls back tool mutations applied before a later-round model failure', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);

    // Round 1 applies a mutation, round 2 throws.
    let call = 0;
    const model: ModelClient = {
      complete(): Promise<string> {
        call += 1;
        if (call === 1) {
          return Promise.resolve(
            toolCall('mutate_state', {
              target: 'character',
              field: 'hp_current',
              op: 'set',
              value: 99,
            }),
          );
        }
        return Promise.reject(new Error('model crashed mid-turn'));
      },
    };

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    expect(result.ok).toBe(false);
    const row = db
      .prepare('SELECT hp_current FROM character WHERE id = 1')
      .get() as { hp_current: number };
    expect(row.hp_current).toBe(0); // schema default — mutation rolled back
    db.close();
  });

  it('records a scene_summary when the model closes a scene', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    // Give the closing scene some prior narration to summarize.
    const setup = new ScriptedModel(['The fire crackles as you settle in.']);
    await runTurn(
      { db, model: setup, registry: createDefaultToolRegistry() },
      baseInput({ turnId: 'turn-0' }),
    );

    const model = new ScriptedModel([
      toolCall('mark_scene', { boundary: 'close' }),
      'The night draws to a close.',
    ]);
    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput({ turnId: 'turn-1' }),
    );

    expect(result.ok).toBe(true);
    const summary = db
      .prepare(
        `SELECT summary FROM scene_summary
         WHERE campaign_id = ? AND session_id = ? AND scene_id = ?`,
      )
      .get(CAMPAIGN, SESSION, 'scene-0') as { summary: string } | undefined;
    expect(summary).toBeDefined();

    // The scene rollup is recorded as a memory update on the turn trace.
    const trace = getTurnTrace(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      turnId: 'turn-1',
    });
    expect(trace?.memoryUpdates).toContainEqual({
      kind: 'scene_summary',
      sceneId: 'scene-0',
    });
    db.close();
  });

  it('records structured trace fields for a turn with roll and mutate_state', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new ScriptedModel([
      toolCall('roll', { dice: '1d20+2', reason: 'perception' }),
      toolCall('mutate_state', {
        target: 'character',
        field: 'hp_current',
        op: 'set',
        value: 9,
      }),
      'You steady yourself and take in the room.',
    ]);

    await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    const trace = getTurnTrace(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      turnId: 'turn-1',
    });
    // The accepted mutation is recorded, not left as a placeholder.
    expect(trace?.acceptedStateDelta).toHaveLength(1);
    expect(trace?.acceptedStateDelta[0]).toMatchObject({
      target: 'character',
      field: 'hp_current',
      value: 9,
    });
    // The dice roll is recorded as a rules resolution.
    const rules = trace?.rulesResolution as {
      rolls: unknown[];
      rulesLookups: unknown[];
    };
    expect(rules.rolls).toHaveLength(1);
    // A clean turn rejects nothing and raises no quality flags.
    expect(trace?.rejectedCandidates).toEqual([]);
    expect(trace?.qualityFlags).toEqual([]);
    db.close();
  });

  it('records rejected candidates and a quality flag when a tool call fails', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    const model = new ScriptedModel([
      toolCall('mutate_state', {
        target: 'character',
        field: 'not_a_real_field',
        op: 'set',
        value: 1,
      }),
      'The attempt comes to nothing.',
    ]);

    await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    const trace = getTurnTrace(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      turnId: 'turn-1',
    });
    expect(trace?.acceptedStateDelta).toEqual([]);
    expect(trace?.rejectedCandidates).toHaveLength(1);
    expect(trace?.rejectedCandidates[0]).toMatchObject({
      tool: 'mutate_state',
    });
    expect(trace?.qualityFlags).toContain('tool_error');
    db.close();
  });

  it('persists the turn into a fallback scene when the model never marks one', async () => {
    const db = freshDbWithSession();
    // No withOpenScene, and the model narrates without calling mark_scene.
    const model = new ScriptedModel(['You step into the misty clearing.']);

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput(),
    );

    expect(result.ok).toBe(true);
    expect(result.sceneId).toBeDefined();
    const log = listSceneLog(db, {
      campaignId: CAMPAIGN,
      sessionId: SESSION,
      sceneId: result.sceneId as string,
    });
    expect(log.map((e) => e.role)).toEqual(['player', 'dm']);
    expect(log[0].content).toBe('I look around the tavern.');
    expect(log[1].content).toBe('You step into the misty clearing.');
    db.close();
  });

  it('fails the turn when tool rounds are exhausted without narration', async () => {
    const db = freshDbWithSession();
    withOpenScene(db);
    // Always returns a tool call — never final narration.
    const model: ModelClient = {
      complete: () =>
        Promise.resolve(toolCall('roll', { dice: '1d6', reason: 'loop' })),
    };

    const result = await runTurn(
      { db, model, registry: createDefaultToolRegistry() },
      baseInput({ maxToolRounds: 3 }),
    );

    expect(result.ok).toBe(false);
    db.close();
  });

  it('is deterministic under a fixed seed', async () => {
    const run = async (): Promise<unknown> => {
      const db = freshDbWithSession();
      withOpenScene(db);
      const model = new ScriptedModel([
        toolCall('roll', { dice: '4d8+3', reason: 'damage' }),
        'The blow lands hard.',
      ]);
      const result = await runTurn(
        { db, model, registry: createDefaultToolRegistry() },
        baseInput({ seed: 777 }),
      );
      db.close();
      return result.toolCalls[0].result;
    };
    expect(await run()).toEqual(await run());
  });
});
