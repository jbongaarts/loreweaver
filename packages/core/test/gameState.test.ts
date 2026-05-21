import { describe, expect, it } from 'vitest';
import {
  MutateStateError,
  getStateProvenance,
  initSchema,
  mutateStateBatch,
  mutateState,
  openDatabase,
} from '../src/index.js';

describe('game state', () => {
  it('mutateState sets a character field with queryable provenance', () => {
    const db = openDatabase(':memory:');
    initSchema(db);

    mutateState(db, {
      target: 'character',
      field: 'name',
      op: 'set',
      value: 'Mira',
      provenance: 'player:session-zero',
      sessionId: 'session-1',
      at: '2026-05-19T04:00:00.000Z',
    });

    const row = db
      .prepare(
        `SELECT name, provenance, session_id, updated_at
         FROM character
         WHERE id = 1`,
      )
      .get() as
      | {
          name: string;
          provenance: string;
          session_id: string;
          updated_at: string;
        }
      | undefined;

    expect(row).toEqual({
      name: 'Mira',
      provenance: 'player:session-zero',
      session_id: 'session-1',
      updated_at: '2026-05-19T04:00:00.000Z',
    });

    db.close();
  });

  it('mutateState writes inventory, plot flags, clock, and overlay facts', () => {
    const db = openDatabase(':memory:');
    initSchema(db);

    mutateState(db, {
      target: 'inventory',
      id: 'torch',
      field: 'name',
      op: 'set',
      value: 'Torch',
      provenance: 'dm:starting-kit',
      sessionId: 'session-1',
      at: '2026-05-19T04:01:00.000Z',
    });
    mutateState(db, {
      target: 'inventory',
      id: 'torch',
      field: 'quantity',
      op: 'set',
      value: 3,
      provenance: 'dm:starting-kit',
      sessionId: 'session-1',
      at: '2026-05-19T04:02:00.000Z',
    });
    mutateState(db, {
      target: 'plot_flags',
      field: 'met_old_road_warden',
      op: 'set',
      value: true,
      provenance: 'narration:turn-2',
      sessionId: 'session-1',
      at: '2026-05-19T04:03:00.000Z',
    });
    mutateState(db, {
      target: 'clock',
      field: 'current_location_id',
      op: 'set',
      value: 'green-hollow',
      provenance: 'movement:turn-3',
      sessionId: 'session-1',
      at: '2026-05-19T04:04:00.000Z',
    });
    mutateState(db, {
      target: 'overlay_facts',
      field: 'goblin_tracks',
      op: 'set',
      value: { direction: 'north', confidence: 'fresh' },
      provenance: 'skill-check:survival',
      sessionId: 'session-1',
      at: '2026-05-19T04:05:00.000Z',
    });

    expect(
      db.prepare('SELECT id, name, quantity, provenance FROM inventory').get(),
    ).toEqual({
      id: 'torch',
      name: 'Torch',
      quantity: 3,
      provenance: 'dm:starting-kit',
    });
    expect(
      db.prepare('SELECT key, value_json, provenance FROM plot_flags').get(),
    ).toEqual({
      key: 'met_old_road_warden',
      value_json: 'true',
      provenance: 'narration:turn-2',
    });
    expect(
      db
        .prepare('SELECT current_location_id, provenance FROM clock WHERE id = 1')
        .get(),
    ).toEqual({
      current_location_id: 'green-hollow',
      provenance: 'movement:turn-3',
    });
    expect(
      db.prepare('SELECT key, value_json, provenance FROM overlay_facts').get(),
    ).toEqual({
      key: 'goblin_tracks',
      value_json: '{"direction":"north","confidence":"fresh"}',
      provenance: 'skill-check:survival',
    });

    db.close();
  });

  it('mutateState rejects invalid operations without changing canon', () => {
    const db = openDatabase(':memory:');
    initSchema(db);

    expect(() =>
      mutateState(db, {
        target: 'character',
        field: 'name',
        op: 'append',
        value: 'Mira',
        provenance: 'player:session-zero',
        sessionId: 'session-1',
        at: '2026-05-19T04:06:00.000Z',
      }),
    ).toThrow(MutateStateError);

    expect(
      db.prepare('SELECT name, provenance FROM character WHERE id = 1').get(),
    ).toEqual({
      name: null,
      provenance: 'system:init_schema',
    });

    db.close();
  });

  it('mutateState rejects invalid typed values without changing canon', () => {
    const db = openDatabase(':memory:');
    initSchema(db);

    expect(() =>
      mutateState(db, {
        target: 'character',
        field: 'hp_current',
        op: 'set',
        value: 'dead',
        provenance: 'narration:turn-4',
        sessionId: 'session-1',
        at: '2026-05-19T04:06:00.000Z',
      }),
    ).toThrow(MutateStateError);

    expect(() =>
      mutateState(db, {
        target: 'inventory',
        id: 'torch',
        field: 'quantity',
        op: 'set',
        value: 'many',
        provenance: 'narration:turn-4',
        sessionId: 'session-1',
        at: '2026-05-19T04:06:00.000Z',
      }),
    ).toThrow(MutateStateError);

    expect(() =>
      mutateState(db, {
        target: 'character',
        field: 'conditions_json',
        op: 'set',
        value: 'poisoned',
        provenance: 'narration:turn-4',
        sessionId: 'session-1',
        at: '2026-05-19T04:06:00.000Z',
      }),
    ).toThrow(MutateStateError);

    expect(
      db
        .prepare(
          `SELECT hp_current, conditions_json, provenance
           FROM character
           WHERE id = 1`,
        )
        .get(),
    ).toEqual({
      hp_current: 0,
      conditions_json: '[]',
      provenance: 'system:init_schema',
    });
    expect(
      db.prepare("SELECT id FROM inventory WHERE id = 'torch'").get(),
    ).toBeUndefined();

    db.close();
  });

  it('mutateStateBatch rolls back all in-flight changes when a turn fails', () => {
    const db = openDatabase(':memory:');
    initSchema(db);

    mutateState(db, {
      target: 'character',
      field: 'name',
      op: 'set',
      value: 'Mira',
      provenance: 'player:session-zero',
      sessionId: 'session-1',
      at: '2026-05-19T04:07:00.000Z',
    });

    expect(() =>
      mutateStateBatch(
        db,
        [
          {
            target: 'character',
            field: 'name',
            op: 'set',
            value: 'Mira the Bold',
            provenance: 'narration:turn-4',
            sessionId: 'session-1',
            at: '2026-05-19T04:08:00.000Z',
          },
          {
            target: 'plot_flags',
            field: 'accepted_the_oath',
            op: 'set',
            value: true,
            provenance: 'narration:turn-4',
            sessionId: 'session-1',
            at: '2026-05-19T04:08:00.000Z',
          },
        ],
        {
          afterMutation(index) {
            if (index === 0) {
              throw new Error('simulated crash');
            }
          },
        },
      ),
    ).toThrow('simulated crash');

    expect(
      db.prepare('SELECT name, provenance FROM character WHERE id = 1').get(),
    ).toEqual({
      name: 'Mira',
      provenance: 'player:session-zero',
    });
    expect(
      db
        .prepare(
          "SELECT key FROM plot_flags WHERE key = 'accepted_the_oath'",
        )
        .get(),
    ).toBeUndefined();

    db.close();
  });

  it('getStateProvenance returns provenance for narrative callbacks', () => {
    const db = openDatabase(':memory:');
    initSchema(db);

    mutateStateBatch(db, [
      {
        target: 'character',
        field: 'name',
        op: 'set',
        value: 'Mira',
        provenance: 'player:session-zero',
        sessionId: 'session-1',
        at: '2026-05-19T04:09:00.000Z',
      },
      {
        target: 'inventory',
        id: 'torch',
        field: 'name',
        op: 'set',
        value: 'Torch',
        provenance: 'dm:starting-kit',
        sessionId: 'session-1',
        at: '2026-05-19T04:10:00.000Z',
      },
      {
        target: 'overlay_facts',
        field: 'goblin_tracks',
        op: 'set',
        value: { direction: 'north' },
        provenance: 'skill-check:survival',
        sessionId: 'session-1',
        at: '2026-05-19T04:11:00.000Z',
      },
    ]);

    expect(
      getStateProvenance(db, { target: 'character', field: 'name' }),
    ).toEqual({
      target: 'character',
      field: 'name',
      provenance: 'player:session-zero',
      sessionId: 'session-1',
      updatedAt: '2026-05-19T04:09:00.000Z',
    });
    expect(
      getStateProvenance(db, {
        target: 'inventory',
        id: 'torch',
        field: 'name',
      }),
    ).toEqual({
      target: 'inventory',
      id: 'torch',
      field: 'name',
      provenance: 'dm:starting-kit',
      sessionId: 'session-1',
      updatedAt: '2026-05-19T04:10:00.000Z',
    });
    expect(
      getStateProvenance(db, {
        target: 'overlay_facts',
        field: 'goblin_tracks',
      }),
    ).toEqual({
      target: 'overlay_facts',
      field: 'goblin_tracks',
      provenance: 'skill-check:survival',
      sessionId: 'session-1',
      updatedAt: '2026-05-19T04:11:00.000Z',
    });

    db.close();
  });
});
