import { addCondition } from '../state/domainMutations.js';
import { MutateStateError } from '../state/mutateState.js';
import { asRecord, err, ok } from './toolRegistry.js';
import type { Tool } from './toolRegistry.js';

export const addConditionTool: Tool = {
  name: 'add_condition',
  description:
    'Add a condition to the character. No-op if a condition with the same id already exists. ' +
    'Extra fields (duration, severity, etc.) are preserved.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description:
          'Unique condition identifier (e.g. "poisoned", "frightened").',
        minLength: 1,
      },
    },
    required: ['id'],
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.id !== 'string') {
      return err('invalid_args', 'add_condition requires { id: string }');
    }
    try {
      const result = addCondition(
        ctx.db,
        a as { id: string; [key: string]: unknown },
        {
          provenance: `model:${ctx.turnId}`,
          sessionId: ctx.sessionId,
          at: ctx.at,
          characterId: ctx.actingCharacterId,
        },
      );
      return ok(result);
    } catch (e) {
      if (e instanceof MutateStateError) {
        return err('mutate_error', e.message);
      }
      throw e;
    }
  },
};
