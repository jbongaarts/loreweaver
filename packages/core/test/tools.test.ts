import { describe, expect, it } from 'vitest';
import {
  DiceError,
  ToolRegistry,
  appendSceneLog,
  createDefaultToolRegistry,
  createSeededRng,
  getOpenScene,
  initSchema,
  openScene,
  openDatabase,
  parseDice,
  recordSceneSummary,
  rollDice,
  startSession,
} from '../src/index.js';
import type { MarkSceneToolData, ToolContext } from '../src/index.js';

const closedMarkSceneDataTypecheck = {
  boundary: 'close',
  scene: {
    campaignId: 'campaign-1',
    sessionId: 'session-1',
    sceneId: 'scene-1',
    title: 'The Tavern',
    status: 'closed',
    openedAt: '2026-05-20T09:00:00.000Z',
    closedAt: '2026-05-20T10:00:00.000Z',
  },
} satisfies MarkSceneToolData;
void closedMarkSceneDataTypecheck;

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  const db = openDatabase(':memory:');
  initSchema(db);
  startSession(db, {
    campaignId: 'campaign-1',
    sessionId: 'session-1',
    startedAt: '2026-05-20T09:00:00.000Z',
  });
  return {
    db,
    rng: createSeededRng(42),
    campaignId: 'campaign-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    at: '2026-05-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('dice notation', () => {
  it('parses count, faces, and modifier', () => {
    expect(parseDice('2d6+3')).toEqual({ count: 2, faces: 6, modifier: 3 });
    expect(parseDice('d20')).toEqual({ count: 1, faces: 20, modifier: 0 });
    expect(parseDice('4d8 - 1')).toEqual({ count: 4, faces: 8, modifier: -1 });
  });

  it('rejects malformed notation', () => {
    expect(() => parseDice('garbage')).toThrow(DiceError);
    expect(() => parseDice('2x6')).toThrow(DiceError);
    expect(() => parseDice('0d6')).toThrow(DiceError);
  });
});

describe('seeded RNG', () => {
  it('produces a reproducible sequence for a fixed seed', () => {
    const a = createSeededRng(123);
    const b = createSeededRng(123);
    const seqA = [a.nextInt(20), a.nextInt(20), a.nextInt(20)];
    const seqB = [b.nextInt(20), b.nextInt(20), b.nextInt(20)];
    expect(seqA).toEqual(seqB);
    for (const n of seqA) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(20);
    }
  });

  it('diverges for different seeds', () => {
    const a = createSeededRng(1);
    const b = createSeededRng(2);
    const seqA = Array.from({ length: 8 }, () => a.nextInt(1000));
    const seqB = Array.from({ length: 8 }, () => b.nextInt(1000));
    expect(seqA).not.toEqual(seqB);
  });
});

describe('rollDice', () => {
  it('is reproducible under a fixed seed', () => {
    const first = rollDice('3d6+2', createSeededRng(7));
    const second = rollDice('3d6+2', createSeededRng(7));
    expect(first).toEqual(second);
    expect(first.rolls).toHaveLength(3);
    expect(first.modifier).toBe(2);
    expect(first.total).toBe(first.rolls[0] + first.rolls[1] + first.rolls[2] + 2);
    for (const r of first.rolls) {
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(6);
    }
  });
});

describe('ToolRegistry', () => {
  it('returns a structured error for an unknown tool', () => {
    const registry = new ToolRegistry();
    const result = registry.invoke('does_not_exist', {}, ctx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('unknown_tool');
    }
  });

  it('lists the default tool set', () => {
    const names = createDefaultToolRegistry().list().sort();
    expect(names).toEqual(
      [
        'lookup_srd',
        'mark_scene',
        'memory_drilldown',
        'mutate_state',
        'roll',
        'world_query',
      ].sort(),
    );
  });
});

describe('roll tool', () => {
  it('rolls reproducibly given a seeded context', () => {
    const registry = createDefaultToolRegistry();
    const a = registry.invoke(
      'roll',
      { dice: '2d20+1', reason: 'attack' },
      ctx({ rng: createSeededRng(99) }),
    );
    const b = registry.invoke(
      'roll',
      { dice: '2d20+1', reason: 'attack' },
      ctx({ rng: createSeededRng(99) }),
    );
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    if (a.ok) {
      const data = a.data as { total: number; rolls: number[] };
      expect(data.rolls).toHaveLength(2);
    }
  });

  it('returns a structured error for malformed dice', () => {
    const result = createDefaultToolRegistry().invoke(
      'roll',
      { dice: 'not-dice', reason: 'attack' },
      ctx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid_dice');
    }
  });

  it('rejects missing arguments', () => {
    const result = createDefaultToolRegistry().invoke('roll', {}, ctx());
    expect(result.ok).toBe(false);
  });

  it('rejects an empty reason', () => {
    const result = createDefaultToolRegistry().invoke(
      'roll',
      { dice: '1d20', reason: '' },
      ctx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid_args');
    }
  });
});

describe('mark_scene tool', () => {
  it('opens then closes the current scene', () => {
    const registry = createDefaultToolRegistry();
    const c = ctx();
    const opened = registry.invoke(
      'mark_scene',
      { boundary: 'open', title: 'The Tavern' },
      c,
    );
    expect(opened.ok).toBe(true);
    expect(getOpenScene(c.db, c)?.title).toBe('The Tavern');

    const closed = registry.invoke('mark_scene', { boundary: 'close' }, c);
    expect(closed.ok).toBe(true);
    expect(getOpenScene(c.db, c)).toBeUndefined();
  });

  it('errors when closing with no open scene', () => {
    const result = createDefaultToolRegistry().invoke(
      'mark_scene',
      { boundary: 'close' },
      ctx(),
    );
    expect(result.ok).toBe(false);
  });
});

describe('lookup_srd tool', () => {
  it('resolves a known monster by name', () => {
    const result = createDefaultToolRegistry().invoke(
      'lookup_srd',
      { kind: 'monster', name: 'Goblin' },
      ctx(),
    );
    expect(result.ok).toBe(true);
  });

  it('returns not_found for an unknown name', () => {
    const result = createDefaultToolRegistry().invoke(
      'lookup_srd',
      { kind: 'monster', name: 'Tarrasque' },
      ctx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('not_found');
    }
  });
});

describe('mutate_state tool', () => {
  it('applies a canonical character mutation', () => {
    const c = ctx();
    const result = createDefaultToolRegistry().invoke(
      'mutate_state',
      { target: 'character', field: 'name', op: 'set', value: 'Mira' },
      c,
    );
    expect(result.ok).toBe(true);
    const row = c.db
      .prepare('SELECT name, provenance FROM character WHERE id = 1')
      .get() as { name: string; provenance: string };
    expect(row.name).toBe('Mira');
    expect(row.provenance).toContain('turn-1');
  });

  it('returns a structured error for an illegal field', () => {
    const result = createDefaultToolRegistry().invoke(
      'mutate_state',
      { target: 'character', field: 'not_a_field', op: 'set', value: 1 },
      ctx(),
    );
    expect(result.ok).toBe(false);
  });

  it('returns a structured error for an invalid canonical value', () => {
    const c = ctx();
    const result = createDefaultToolRegistry().invoke(
      'mutate_state',
      { target: 'character', field: 'hp_current', op: 'set', value: 'dead' },
      c,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('mutate_error');
    }
    expect(
      c.db.prepare('SELECT hp_current FROM character WHERE id = 1').get(),
    ).toEqual({ hp_current: 0 });
  });
});

describe('world_query tool', () => {
  it('returns not_found for an absent target', () => {
    const result = createDefaultToolRegistry().invoke(
      'world_query',
      { type: 'npc', id: 'ghost' },
      ctx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('not_found');
    }
  });
});

describe('memory_drilldown tool', () => {
  it('resolves a recorded scene summary', () => {
    const c = ctx();
    recordSceneSummary(c.db, {
      campaignId: c.campaignId,
      sessionId: c.sessionId,
      sceneId: 'scene-1',
      summary: 'The party met the barkeep.',
      salientRefs: [],
      sourceTurnIds: ['turn-0'],
      createdAt: c.at,
      updatedAt: c.at,
    });
    const result = createDefaultToolRegistry().invoke(
      'memory_drilldown',
      {
        target: 'scene',
        campaignId: c.campaignId,
        sessionId: c.sessionId,
        sceneId: 'scene-1',
      },
      c,
    );
    expect(result.ok).toBe(true);
  });

  it('returns not_found for an absent summary', () => {
    const result = createDefaultToolRegistry().invoke(
      'memory_drilldown',
      {
        target: 'scene',
        campaignId: 'campaign-1',
        sessionId: 'session-1',
        sceneId: 'nope',
      },
      ctx(),
    );
    expect(result.ok).toBe(false);
  });

  it('retrieves an omitted current-scene transcript window', () => {
    const c = ctx();
    openScene(c.db, {
      campaignId: c.campaignId,
      sessionId: c.sessionId,
      sceneId: 'scene-1',
      title: 'The Tavern',
      at: c.at,
    });
    for (const n of [1, 2, 3]) {
      appendSceneLog(c.db, {
        campaignId: c.campaignId,
        sessionId: c.sessionId,
        sceneId: 'scene-1',
        turnId: `turn-${n}`,
        role: 'player',
        content: `line ${n}`,
        at: c.at,
      });
    }

    const result = createDefaultToolRegistry().invoke(
      'memory_drilldown',
      {
        target: 'scene_log',
        campaignId: c.campaignId,
        sessionId: c.sessionId,
        sceneId: 'scene-1',
        beforeSeq: 3,
        limit: 2,
      },
      c,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as {
        target: 'scene_log';
        records: Array<{ content: string }>;
      };
      expect(data.records.map((e) => e.content)).toEqual(['line 1', 'line 2']);
    }
  });
});

describe('scene-log integration witness', () => {
  it('mark_scene opens a scene the orchestrator can log into', () => {
    const c = ctx();
    createDefaultToolRegistry().invoke(
      'mark_scene',
      { boundary: 'open', title: 'The Tavern' },
      c,
    );
    const open = getOpenScene(c.db, c);
    expect(open).toBeDefined();
    if (open) {
      const entry = appendSceneLog(c.db, {
        campaignId: c.campaignId,
        sessionId: c.sessionId,
        sceneId: open.sceneId,
        turnId: c.turnId,
        role: 'player',
        content: 'I order an ale.',
        at: c.at,
      });
      expect(entry.seq).toBe(1);
    }
  });
});
