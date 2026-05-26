import { MutateStateError, mutateState } from '../state/mutateState.js';
import type {
  MutateStateTarget,
  MutateStateValue,
} from '../state/mutateState.js';
import { asRecord, err, ok } from './toolRegistry.js';
import type { Tool } from './toolRegistry.js';

export const mutateStateTool: Tool = {
  name: 'mutate_state',
  description:
    'Write canonical game state. args: { target, id?, field, op: "set", value }.',
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.target !== 'string' ||
      typeof a.field !== 'string' ||
      a.op !== 'set'
    ) {
      return err(
        'invalid_args',
        'mutate_state requires { target, field, op: "set", value }',
      );
    }
    try {
      mutateState(ctx.db, {
        target: a.target as MutateStateTarget,
        id: typeof a.id === 'string' ? a.id : undefined,
        field: a.field,
        op: 'set',
        value: a.value as MutateStateValue,
        provenance: `model:${ctx.turnId}`,
        sessionId: ctx.sessionId,
        at: ctx.at,
      });
      return ok({
        applied: true,
        target: a.target,
        field: a.field,
        id: typeof a.id === 'string' ? a.id : undefined,
      });
    } catch (e) {
      if (e instanceof MutateStateError) {
        return err('mutate_error', e.message);
      }
      throw e;
    }
  },
};
