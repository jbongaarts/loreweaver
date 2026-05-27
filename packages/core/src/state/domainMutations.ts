import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { resolveCharacterId } from './activeCharacter.js';
import type { CharacterConditionEntry } from './liveStateSchema.js';
import {
  MutateStateError,
  type MutateStateInput,
  type MutateStateValue,
  mutateState,
  mutateStateBatch,
} from './mutateState.js';

export interface DomainMutationContext {
  provenance: string;
  sessionId: string;
  at: string;
  characterId?: string;
}

export interface AdjustHpResult {
  previousHp: number;
  newHp: number;
  hpMax: number;
  clamped: boolean;
}

export function adjustHp(
  db: Db,
  amount: number,
  ctx: DomainMutationContext,
): AdjustHpResult {
  if (!Number.isInteger(amount)) {
    throw new MutateStateError('adjust_hp amount must be an integer');
  }

  return withTransaction(db, (txnDb) => {
    const charId = resolveCharacterId(txnDb, ctx.characterId);
    const row = txnDb
      .prepare('SELECT hp_current, hp_max FROM character WHERE id = ?')
      .get(charId) as { hp_current: number; hp_max: number } | undefined;

    if (row === undefined) {
      throw new MutateStateError('no character row exists');
    }

    const raw = row.hp_current + amount;
    const clamped = raw !== Math.max(0, Math.min(raw, row.hp_max));
    const newHp = Math.max(0, Math.min(raw, row.hp_max));

    mutateState(txnDb, {
      target: 'character',
      id: charId,
      field: 'hp_current',
      op: 'set',
      value: newHp,
      ...ctx,
    });

    return {
      previousHp: row.hp_current,
      newHp,
      hpMax: row.hp_max,
      clamped,
    };
  });
}

export interface AddConditionInput {
  id: string;
  [key: string]: unknown;
}

export interface AddConditionResult {
  added: boolean;
  conditions: readonly CharacterConditionEntry[];
}

export function addCondition(
  db: Db,
  condition: AddConditionInput,
  ctx: DomainMutationContext,
): AddConditionResult {
  if (typeof condition.id !== 'string' || condition.id.length === 0) {
    throw new MutateStateError('condition id must be a non-empty string');
  }

  return withTransaction(db, (txnDb) => {
    const charId = resolveCharacterId(txnDb, ctx.characterId);
    const current = readConditions(txnDb, charId);

    if (current.some((c) => c.id === condition.id)) {
      return { added: false, conditions: current };
    }

    const entry: CharacterConditionEntry = {
      ...condition,
    } as CharacterConditionEntry;
    const updated = [...current, entry];

    mutateState(txnDb, {
      target: 'character',
      id: charId,
      field: 'conditions_json',
      op: 'set',
      value: updated,
      ...ctx,
    });

    return { added: true, conditions: updated };
  });
}

export interface RemoveConditionResult {
  removed: boolean;
  conditions: readonly CharacterConditionEntry[];
}

export function removeCondition(
  db: Db,
  conditionId: string,
  ctx: DomainMutationContext,
): RemoveConditionResult {
  if (typeof conditionId !== 'string' || conditionId.length === 0) {
    throw new MutateStateError('condition id must be a non-empty string');
  }

  return withTransaction(db, (txnDb) => {
    const charId = resolveCharacterId(txnDb, ctx.characterId);
    const current = readConditions(txnDb, charId);
    const updated = current.filter((c) => c.id !== conditionId);

    if (updated.length === current.length) {
      return { removed: false, conditions: current };
    }

    mutateState(txnDb, {
      target: 'character',
      id: charId,
      field: 'conditions_json',
      op: 'set',
      value: updated,
      ...ctx,
    });

    return { removed: true, conditions: updated };
  });
}

export interface GiveItemInput {
  id: string;
  name: string;
  quantity?: number;
  location?: string | null;
  properties?: Record<string, unknown>;
}

export function giveItem(
  db: Db,
  item: GiveItemInput,
  ctx: DomainMutationContext,
): void {
  if (typeof item.id !== 'string' || item.id.length === 0) {
    throw new MutateStateError('item id must be a non-empty string');
  }
  if (typeof item.name !== 'string' || item.name.length === 0) {
    throw new MutateStateError('item name must be a non-empty string');
  }

  const base = {
    target: 'inventory' as const,
    id: item.id,
    op: 'set' as const,
    ...ctx,
  };

  const mutations: MutateStateInput[] = [
    { ...base, field: 'name', value: item.name },
    { ...base, field: 'quantity', value: item.quantity ?? 1 },
  ];

  if (item.location !== undefined) {
    mutations.push({ ...base, field: 'location', value: item.location });
  }

  if (item.properties !== undefined) {
    mutations.push({
      ...base,
      field: 'properties_json',
      value: item.properties,
    });
  }

  mutateStateBatch(db, mutations);
}

export interface RemoveItemResult {
  removed: boolean;
  previousQuantity: number;
  newQuantity: number;
}

export function removeItem(
  db: Db,
  itemId: string,
  quantity: number | undefined,
  ctx: DomainMutationContext,
): RemoveItemResult {
  if (typeof itemId !== 'string' || itemId.length === 0) {
    throw new MutateStateError('item id must be a non-empty string');
  }
  if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1)) {
    throw new MutateStateError(
      'remove_item quantity must be a positive integer',
    );
  }

  return withTransaction(db, (txnDb) => {
    const row = txnDb
      .prepare('SELECT quantity FROM inventory WHERE id = ?')
      .get(itemId) as { quantity: number } | undefined;

    if (row === undefined) {
      return { removed: false, previousQuantity: 0, newQuantity: 0 };
    }

    const previousQuantity = row.quantity;

    if (quantity === undefined || previousQuantity - quantity <= 0) {
      txnDb.prepare('DELETE FROM inventory WHERE id = ?').run(itemId);
      return { removed: true, previousQuantity, newQuantity: 0 };
    }

    const newQuantity = previousQuantity - quantity;
    mutateState(txnDb, {
      target: 'inventory',
      id: itemId,
      field: 'quantity',
      op: 'set',
      value: newQuantity,
      ...ctx,
    });

    return { removed: false, previousQuantity, newQuantity };
  });
}

export interface UpdateClockInput {
  inGameTime?: string;
  locationId?: string | null;
}

export function updateClock(
  db: Db,
  input: UpdateClockInput,
  ctx: DomainMutationContext,
): void {
  const base = {
    target: 'clock' as const,
    op: 'set' as const,
    ...ctx,
  };

  const mutations = [];

  if (input.inGameTime !== undefined) {
    mutations.push({ ...base, field: 'in_game_time', value: input.inGameTime });
  }
  if (input.locationId !== undefined) {
    mutations.push({
      ...base,
      field: 'current_location_id',
      value: input.locationId as MutateStateValue,
    });
  }

  if (mutations.length === 0) {
    throw new MutateStateError(
      'update_clock requires at least one of in_game_time or location_id',
    );
  }

  mutateStateBatch(db, mutations);
}

export function setPlotFlag(
  db: Db,
  key: string,
  value: MutateStateValue,
  ctx: DomainMutationContext,
): void {
  mutateState(db, {
    target: 'plot_flags',
    field: key,
    op: 'set',
    value,
    ...ctx,
  });
}

export function setWorldFact(
  db: Db,
  key: string,
  value: MutateStateValue,
  ctx: DomainMutationContext,
): void {
  mutateState(db, {
    target: 'overlay_facts',
    field: key,
    op: 'set',
    value,
    ...ctx,
  });
}

function readConditions(
  db: Db,
  characterId: string,
): CharacterConditionEntry[] {
  const row = db
    .prepare('SELECT conditions_json FROM character WHERE id = ?')
    .get(characterId) as { conditions_json: string } | undefined;

  if (row === undefined) {
    throw new MutateStateError('no character row exists');
  }

  return JSON.parse(row.conditions_json) as CharacterConditionEntry[];
}
