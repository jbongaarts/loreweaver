import { describe, expect, it } from 'vitest';
import {
  MutateStateError,
  addCondition,
  adjustHp,
  giveItem,
  initSchema,
  mutateState,
  openDatabase,
  removeCondition,
  removeItem,
  setPlotFlag,
  setWorldFact,
  updateClock,
} from '../src/internal.js';

const CTX = {
  provenance: 'test:domain',
  sessionId: 'session-1',
  at: '2026-05-26T00:00:00.000Z',
};

function freshDb() {
  const db = openDatabase(':memory:');
  initSchema(db);
  return db;
}

describe('adjustHp', () => {
  it('heals within bounds', () => {
    const db = freshDb();
    mutateState(db, {
      target: 'character',
      field: 'hp_max',
      op: 'set',
      value: 20,
      ...CTX,
    });
    mutateState(db, {
      target: 'character',
      field: 'hp_current',
      op: 'set',
      value: 10,
      ...CTX,
    });

    const result = adjustHp(db, 5, CTX);

    expect(result).toEqual({
      previousHp: 10,
      newHp: 15,
      hpMax: 20,
      clamped: false,
    });
    db.close();
  });

  it('clamps healing to hp_max', () => {
    const db = freshDb();
    mutateState(db, {
      target: 'character',
      field: 'hp_max',
      op: 'set',
      value: 20,
      ...CTX,
    });
    mutateState(db, {
      target: 'character',
      field: 'hp_current',
      op: 'set',
      value: 18,
      ...CTX,
    });

    const result = adjustHp(db, 10, CTX);

    expect(result).toEqual({
      previousHp: 18,
      newHp: 20,
      hpMax: 20,
      clamped: true,
    });
    db.close();
  });

  it('clamps damage to zero', () => {
    const db = freshDb();
    mutateState(db, {
      target: 'character',
      field: 'hp_max',
      op: 'set',
      value: 20,
      ...CTX,
    });
    mutateState(db, {
      target: 'character',
      field: 'hp_current',
      op: 'set',
      value: 3,
      ...CTX,
    });

    const result = adjustHp(db, -10, CTX);

    expect(result).toEqual({
      previousHp: 3,
      newHp: 0,
      hpMax: 20,
      clamped: true,
    });
    db.close();
  });

  it('rejects non-integer amount', () => {
    const db = freshDb();
    expect(() => adjustHp(db, 1.5, CTX)).toThrow(MutateStateError);
    db.close();
  });
});

describe('addCondition / removeCondition', () => {
  it('adds a condition with extra fields', () => {
    const db = freshDb();

    const result = addCondition(
      db,
      { id: 'poisoned', severity: 'moderate', duration: '3 rounds' },
      CTX,
    );

    expect(result.added).toBe(true);
    expect(result.conditions).toEqual([
      { id: 'poisoned', severity: 'moderate', duration: '3 rounds' },
    ]);
    db.close();
  });

  it('is idempotent when adding a duplicate', () => {
    const db = freshDb();
    addCondition(db, { id: 'poisoned' }, CTX);

    const result = addCondition(db, { id: 'poisoned' }, CTX);

    expect(result.added).toBe(false);
    expect(result.conditions).toHaveLength(1);
    db.close();
  });

  it('removes a condition', () => {
    const db = freshDb();
    addCondition(db, { id: 'poisoned' }, CTX);
    addCondition(db, { id: 'frightened' }, CTX);

    const result = removeCondition(db, 'poisoned', CTX);

    expect(result.removed).toBe(true);
    expect(result.conditions).toEqual([{ id: 'frightened' }]);
    db.close();
  });

  it('no-ops when removing a non-existent condition', () => {
    const db = freshDb();

    const result = removeCondition(db, 'stunned', CTX);

    expect(result.removed).toBe(false);
    db.close();
  });

  it('rejects empty condition id', () => {
    const db = freshDb();
    expect(() => addCondition(db, { id: '' }, CTX)).toThrow(MutateStateError);
    expect(() => removeCondition(db, '', CTX)).toThrow(MutateStateError);
    db.close();
  });
});

describe('giveItem', () => {
  it('creates a new inventory item', () => {
    const db = freshDb();

    giveItem(
      db,
      {
        id: 'torch',
        name: 'Torch',
        quantity: 5,
        location: 'backpack',
        properties: { light_radius: 20 },
      },
      CTX,
    );

    const row = db
      .prepare(
        'SELECT id, name, quantity, location, properties_json FROM inventory WHERE id = ?',
      )
      .get('torch') as Record<string, unknown>;
    expect(row).toEqual({
      id: 'torch',
      name: 'Torch',
      quantity: 5,
      location: 'backpack',
      properties_json: '{"light_radius":20}',
    });
    db.close();
  });

  it('defaults quantity to 1', () => {
    const db = freshDb();

    giveItem(db, { id: 'sword', name: 'Longsword' }, CTX);

    const row = db
      .prepare('SELECT quantity FROM inventory WHERE id = ?')
      .get('sword') as { quantity: number };
    expect(row.quantity).toBe(1);
    db.close();
  });

  it('updates an existing item', () => {
    const db = freshDb();
    giveItem(db, { id: 'torch', name: 'Torch', quantity: 3 }, CTX);

    giveItem(db, { id: 'torch', name: 'Torch', quantity: 5 }, CTX);

    const row = db
      .prepare('SELECT quantity FROM inventory WHERE id = ?')
      .get('torch') as { quantity: number };
    expect(row.quantity).toBe(5);
    db.close();
  });

  it('rejects empty item id', () => {
    const db = freshDb();
    expect(() => giveItem(db, { id: '', name: 'Nothing' }, CTX)).toThrow(
      MutateStateError,
    );
    db.close();
  });
});

describe('removeItem', () => {
  it('removes entire item when quantity omitted', () => {
    const db = freshDb();
    giveItem(db, { id: 'torch', name: 'Torch', quantity: 5 }, CTX);

    const result = removeItem(db, 'torch', undefined, CTX);

    expect(result).toEqual({
      removed: true,
      previousQuantity: 5,
      newQuantity: 0,
    });
    expect(
      db.prepare('SELECT id FROM inventory WHERE id = ?').get('torch'),
    ).toBeUndefined();
    db.close();
  });

  it('decrements quantity', () => {
    const db = freshDb();
    giveItem(db, { id: 'torch', name: 'Torch', quantity: 5 }, CTX);

    const result = removeItem(db, 'torch', 2, CTX);

    expect(result).toEqual({
      removed: false,
      previousQuantity: 5,
      newQuantity: 3,
    });
    db.close();
  });

  it('deletes item when quantity would drop to zero', () => {
    const db = freshDb();
    giveItem(db, { id: 'torch', name: 'Torch', quantity: 2 }, CTX);

    const result = removeItem(db, 'torch', 5, CTX);

    expect(result).toEqual({
      removed: true,
      previousQuantity: 2,
      newQuantity: 0,
    });
    expect(
      db.prepare('SELECT id FROM inventory WHERE id = ?').get('torch'),
    ).toBeUndefined();
    db.close();
  });

  it('returns removed=false for non-existent item', () => {
    const db = freshDb();

    const result = removeItem(db, 'nonexistent', undefined, CTX);

    expect(result).toEqual({
      removed: false,
      previousQuantity: 0,
      newQuantity: 0,
    });
    db.close();
  });
});

describe('updateClock', () => {
  it('updates time and location', () => {
    const db = freshDb();

    updateClock(
      db,
      { inGameTime: 'Day 3, dusk', locationId: 'green-hollow' },
      CTX,
    );

    const row = db
      .prepare(
        'SELECT in_game_time, current_location_id FROM clock WHERE id = 1',
      )
      .get() as { in_game_time: string; current_location_id: string };
    expect(row).toEqual({
      in_game_time: 'Day 3, dusk',
      current_location_id: 'green-hollow',
    });
    db.close();
  });

  it('updates only location', () => {
    const db = freshDb();

    updateClock(db, { locationId: 'tavern' }, CTX);

    const row = db
      .prepare('SELECT current_location_id FROM clock WHERE id = 1')
      .get() as { current_location_id: string };
    expect(row.current_location_id).toBe('tavern');
    db.close();
  });

  it('rejects empty update', () => {
    const db = freshDb();
    expect(() => updateClock(db, {}, CTX)).toThrow(MutateStateError);
    db.close();
  });
});

describe('setPlotFlag', () => {
  it('sets a boolean flag', () => {
    const db = freshDb();

    setPlotFlag(db, 'met_warden', true, CTX);

    const row = db
      .prepare('SELECT value_json FROM plot_flags WHERE key = ?')
      .get('met_warden') as { value_json: string };
    expect(row.value_json).toBe('true');
    db.close();
  });

  it('sets a complex flag value', () => {
    const db = freshDb();

    setPlotFlag(db, 'quest_progress', { step: 3, complete: false }, CTX);

    const row = db
      .prepare('SELECT value_json FROM plot_flags WHERE key = ?')
      .get('quest_progress') as { value_json: string };
    expect(JSON.parse(row.value_json)).toEqual({
      step: 3,
      complete: false,
    });
    db.close();
  });
});

describe('setWorldFact', () => {
  it('sets an overlay fact', () => {
    const db = freshDb();

    setWorldFact(
      db,
      'world:location:green-hollow:name',
      'The Hidden Grove',
      CTX,
    );

    const row = db
      .prepare('SELECT value_json FROM overlay_facts WHERE key = ?')
      .get('world:location:green-hollow:name') as { value_json: string };
    expect(JSON.parse(row.value_json)).toBe('The Hidden Grove');
    db.close();
  });
});
