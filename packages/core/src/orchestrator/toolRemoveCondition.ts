import { removeCondition } from '../state/domainMutations.js';
import { MutateStateError } from '../state/mutateState.js';
import { asRecord, err, ok } from './toolRegistry.js';
import type { Tool } from './toolRegistry.js';

export const removeConditionTool: Tool = {
  name: 'remove_condition',
  description:
    'Remove a condition from the character by id. No-op if the condition is not present.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The condition id to remove.',
        minLength: 1,
      },
    },
    required: ['id'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.id !== 'string') {
      return err('invalid_args', 'remove_condition requires { id: string }');
    }
    try {
      const result = removeCondition(ctx.db, a.id, {
        provenance: `model:${ctx.turnId}`,
        sessionId: ctx.sessionId,
        at: ctx.at,
        characterId: ctx.actingCharacterId,
      });
      return ok(result);
    } catch (e) {
      if (e instanceof MutateStateError) {
        return err('mutate_error', e.message);
      }
      throw e;
    }
  },
};
