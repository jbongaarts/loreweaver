import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';

export type MutateStateTarget = 'character';
export type MutateStateOp = 'set';

export interface MutateStateInput {
  target: MutateStateTarget;
  field: string;
  op: MutateStateOp;
  value: string | number | null;
  provenance: string;
  sessionId: string;
  at: string;
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

export class MutateStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MutateStateError';
  }
}

export function mutateState(db: Db, input: MutateStateInput): void {
  validateCommonInput(input);
  if (input.target !== 'character') {
    throw new MutateStateError(`Unsupported mutate_state target: ${input.target}`);
  }
  if (input.op !== 'set') {
    throw new MutateStateError(`Unsupported mutate_state op: ${input.op}`);
  }
  if (!CHARACTER_SET_FIELDS.has(input.field)) {
    throw new MutateStateError(
      `Unsupported character mutate_state field: ${input.field}`,
    );
  }

  withTransaction(db, (txnDb) => {
    txnDb
      .prepare(
        `UPDATE character
         SET ${input.field} = ?,
             provenance = ?,
             session_id = ?,
             updated_at = ?
         WHERE id = 1`,
      )
      .run(input.value, input.provenance, input.sessionId, input.at);
  });
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
