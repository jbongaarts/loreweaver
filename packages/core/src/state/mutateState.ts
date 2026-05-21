import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';

export type MutateStateTarget =
  | 'character'
  | 'inventory'
  | 'plot_flags'
  | 'clock'
  | 'overlay_facts';
export type MutateStateOp = 'set';
export type MutateStateValue =
  | string
  | number
  | boolean
  | null
  | Record<string, unknown>
  | Array<unknown>;

export interface MutateStateInput {
  target: MutateStateTarget;
  id?: string;
  field: string;
  op: MutateStateOp;
  value: MutateStateValue;
  provenance: string;
  sessionId: string;
  at: string;
}

export interface MutateStateBatchOptions {
  afterMutation?: (index: number) => void;
}

export interface StateProvenanceQuery {
  target: MutateStateTarget;
  id?: string;
  field: string;
}

export interface StateProvenanceRecord {
  target: MutateStateTarget;
  id?: string;
  field: string;
  provenance: string;
  sessionId: string;
  updatedAt: string;
}

const CHARACTER_SET_FIELDS = new Set([
  'name',
  'ancestry',
  'class_name',
  'level',
  'hp_current',
  'hp_max',
  'ability_scores_json',
  'conditions_json',
]);

const INVENTORY_SET_FIELDS = new Set([
  'name',
  'quantity',
  'location',
  'properties_json',
]);

const CLOCK_SET_FIELDS = new Set(['in_game_time', 'current_location_id']);

export class MutateStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MutateStateError';
  }
}

export function mutateState(db: Db, input: MutateStateInput): void {
  validateCommonInput(input);
  if (input.op !== 'set') {
    throw new MutateStateError(`Unsupported mutate_state op: ${input.op}`);
  }

  withTransaction(db, (txnDb) => {
    switch (input.target) {
      case 'character':
        setCharacterField(txnDb, input);
        return;
      case 'inventory':
        setInventoryField(txnDb, input);
        return;
      case 'plot_flags':
        setKeyedJsonFact(txnDb, 'plot_flags', input);
        return;
      case 'clock':
        setClockField(txnDb, input);
        return;
      case 'overlay_facts':
        setKeyedJsonFact(txnDb, 'overlay_facts', input);
        return;
      default:
        throw new MutateStateError(
          `Unsupported mutate_state target: ${input.target}`,
        );
    }
  });
}

export function mutateStateBatch(
  db: Db,
  inputs: MutateStateInput[],
  options: MutateStateBatchOptions = {},
): void {
  withTransaction(db, () => {
    inputs.forEach((input, index) => {
      mutateState(db, input);
      options.afterMutation?.(index);
    });
  });
}

export function getStateProvenance(
  db: Db,
  query: StateProvenanceQuery,
): StateProvenanceRecord | undefined {
  switch (query.target) {
    case 'character':
      requireAllowedField('character', query.field, CHARACTER_SET_FIELDS);
      return readSingletonProvenance(db, query, 'character');
    case 'clock':
      requireAllowedField('clock', query.field, CLOCK_SET_FIELDS);
      return readSingletonProvenance(db, query, 'clock');
    case 'inventory':
      if (query.id === undefined || query.id.length === 0) {
        throw new MutateStateError('inventory provenance query id is required');
      }
      requireAllowedField('inventory', query.field, INVENTORY_SET_FIELDS);
      return readInventoryProvenance(db, query);
    case 'plot_flags':
      return readKeyedFactProvenance(db, query, 'plot_flags');
    case 'overlay_facts':
      return readKeyedFactProvenance(db, query, 'overlay_facts');
    default:
      throw new MutateStateError(
        `Unsupported state provenance target: ${query.target}`,
      );
  }
}

function validateCommonInput(input: MutateStateInput): void {
  if (input.provenance.length === 0) {
    throw new MutateStateError('mutate_state provenance is required');
  }
  if (input.sessionId.length === 0) {
    throw new MutateStateError('mutate_state sessionId is required');
  }
  if (input.at.length === 0) {
    throw new MutateStateError('mutate_state timestamp is required');
  }
}

function setCharacterField(db: Db, input: MutateStateInput): void {
  requireAllowedField('character', input.field, CHARACTER_SET_FIELDS);
  const value = validatedCharacterValue(input.field, input.value);
  db.prepare(
    `UPDATE character
     SET ${input.field} = ?,
         provenance = ?,
         session_id = ?,
         updated_at = ?
     WHERE id = 1`,
  ).run(value, input.provenance, input.sessionId, input.at);
}

function setInventoryField(db: Db, input: MutateStateInput): void {
  if (input.id === undefined || input.id.length === 0) {
    throw new MutateStateError('inventory mutate_state id is required');
  }
  requireAllowedField('inventory', input.field, INVENTORY_SET_FIELDS);
  const value = validatedInventoryValue(input.field, input.value);

  db.prepare(
    `INSERT INTO inventory(
       id,
       name,
       provenance,
       session_id,
       updated_at
     )
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(
    input.id,
    input.field === 'name' ? value : input.id,
    input.provenance,
    input.sessionId,
    input.at,
  );
  db.prepare(
    `UPDATE inventory
     SET ${input.field} = ?,
         provenance = ?,
         session_id = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(value, input.provenance, input.sessionId, input.at, input.id);
}

function setClockField(db: Db, input: MutateStateInput): void {
  requireAllowedField('clock', input.field, CLOCK_SET_FIELDS);
  const value = validatedClockValue(input.field, input.value);
  db.prepare(
    `UPDATE clock
     SET ${input.field} = ?,
         provenance = ?,
         session_id = ?,
         updated_at = ?
     WHERE id = 1`,
  ).run(value, input.provenance, input.sessionId, input.at);
}

function requireAllowedField(
  target: string,
  field: string,
  allowedFields: Set<string>,
): void {
  if (!allowedFields.has(field)) {
    throw new MutateStateError(
      `Unsupported ${target} mutate_state field: ${field}`,
    );
  }
}

function readSingletonProvenance(
  db: Db,
  query: StateProvenanceQuery,
  table: 'character' | 'clock',
): StateProvenanceRecord | undefined {
  const row = db
    .prepare(
      `SELECT provenance, session_id, updated_at
       FROM ${table}
       WHERE id = 1`,
    )
    .get() as ProvenanceRow | undefined;
  return provenanceRecordFromRow(query, row);
}

function readInventoryProvenance(
  db: Db,
  query: StateProvenanceQuery,
): StateProvenanceRecord | undefined {
  const row = db
    .prepare(
      `SELECT provenance, session_id, updated_at
       FROM inventory
       WHERE id = ?`,
    )
    .get(query.id) as ProvenanceRow | undefined;
  return provenanceRecordFromRow(query, row);
}

function readKeyedFactProvenance(
  db: Db,
  query: StateProvenanceQuery,
  table: 'plot_flags' | 'overlay_facts',
): StateProvenanceRecord | undefined {
  const row = db
    .prepare(
      `SELECT provenance, session_id, updated_at
       FROM ${table}
       WHERE key = ?`,
    )
    .get(query.field) as ProvenanceRow | undefined;
  return provenanceRecordFromRow(query, row);
}

interface ProvenanceRow {
  provenance: string;
  session_id: string;
  updated_at: string;
}

function provenanceRecordFromRow(
  query: StateProvenanceQuery,
  row: ProvenanceRow | undefined,
): StateProvenanceRecord | undefined {
  if (row === undefined) {
    return undefined;
  }
  return {
    target: query.target,
    id: query.id,
    field: query.field,
    provenance: row.provenance,
    sessionId: row.session_id,
    updatedAt: row.updated_at,
  };
}

function setKeyedJsonFact(
  db: Db,
  table: 'plot_flags' | 'overlay_facts',
  input: MutateStateInput,
): void {
  const valueJson = serializeJsonValue(input.value, `${table}.${input.field}`);
  db.prepare(
    `INSERT INTO ${table}(
       key,
       value_json,
       provenance,
       session_id,
       updated_at
     )
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value_json = excluded.value_json,
       provenance = excluded.provenance,
       session_id = excluded.session_id,
       updated_at = excluded.updated_at`,
  ).run(
    input.field,
    valueJson,
    input.provenance,
    input.sessionId,
    input.at,
  );
}

type SqlValue = string | number | null;

const CHARACTER_TEXT_FIELDS = new Set(['name', 'ancestry', 'class_name']);
const CHARACTER_INTEGER_FIELDS = new Set(['level', 'hp_current', 'hp_max']);
const CHARACTER_JSON_FIELDS = new Set([
  'ability_scores_json',
  'conditions_json',
]);
const INVENTORY_TEXT_FIELDS = new Set(['name', 'location']);
const INVENTORY_JSON_FIELDS = new Set(['properties_json']);
const CLOCK_TEXT_FIELDS = new Set(['in_game_time', 'current_location_id']);

function validatedCharacterValue(
  field: string,
  value: MutateStateValue,
): SqlValue {
  if (CHARACTER_TEXT_FIELDS.has(field)) {
    return nullableStringValue('character', field, value);
  }
  if (CHARACTER_INTEGER_FIELDS.has(field)) {
    return nonNegativeIntegerValue('character', field, value, {
      min: field === 'level' ? 1 : 0,
    });
  }
  if (CHARACTER_JSON_FIELDS.has(field)) {
    return jsonColumnValue('character', field, value, {
      expectedRoot: field === 'conditions_json' ? 'array' : 'object',
    });
  }
  throw new MutateStateError(`Unsupported character mutate_state field: ${field}`);
}

function validatedInventoryValue(
  field: string,
  value: MutateStateValue,
): SqlValue {
  if (INVENTORY_TEXT_FIELDS.has(field)) {
    return field === 'name'
      ? requiredStringValue('inventory', field, value)
      : nullableStringValue('inventory', field, value);
  }
  if (field === 'quantity') {
    return nonNegativeIntegerValue('inventory', field, value, { min: 0 });
  }
  if (INVENTORY_JSON_FIELDS.has(field)) {
    return jsonColumnValue('inventory', field, value, {
      expectedRoot: 'object',
    });
  }
  throw new MutateStateError(`Unsupported inventory mutate_state field: ${field}`);
}

function validatedClockValue(field: string, value: MutateStateValue): SqlValue {
  if (CLOCK_TEXT_FIELDS.has(field)) {
    return field === 'in_game_time'
      ? requiredStringValue('clock', field, value)
      : nullableStringValue('clock', field, value);
  }
  throw new MutateStateError(`Unsupported clock mutate_state field: ${field}`);
}

function requiredStringValue(
  target: string,
  field: string,
  value: MutateStateValue,
): string {
  if (typeof value !== 'string') {
    throw new MutateStateError(`${target}.${field} must be a string`);
  }
  return value;
}

function nullableStringValue(
  target: string,
  field: string,
  value: MutateStateValue,
): string | null {
  if (value === null) {
    return null;
  }
  return requiredStringValue(target, field, value);
}

function nonNegativeIntegerValue(
  target: string,
  field: string,
  value: MutateStateValue,
  options: { min: number },
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < options.min
  ) {
    throw new MutateStateError(
      `${target}.${field} must be an integer >= ${options.min}`,
    );
  }
  return value;
}

function jsonColumnValue(
  target: string,
  field: string,
  value: MutateStateValue,
  options: { expectedRoot: 'array' | 'object' },
): string {
  const parsed = parseOrUseJsonValue(target, field, value);
  const rootIsArray = Array.isArray(parsed);
  if (
    (options.expectedRoot === 'array' && !rootIsArray) ||
    (options.expectedRoot === 'object' &&
      (rootIsArray || typeof parsed !== 'object' || parsed === null))
  ) {
    throw new MutateStateError(
      `${target}.${field} must be a JSON ${options.expectedRoot}`,
    );
  }
  return serializeJsonValue(parsed, `${target}.${field}`);
}

function parseOrUseJsonValue(
  target: string,
  field: string,
  value: MutateStateValue,
): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new MutateStateError(`${target}.${field} must be valid JSON`);
  }
}

function serializeJsonValue(value: unknown, label: string): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new MutateStateError(`${label} must be JSON-serializable`);
  }
  return serialized;
}
