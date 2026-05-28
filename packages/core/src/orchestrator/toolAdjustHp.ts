import { adjustHp } from '../state/domainMutations.js';
import { MutateStateError } from '../state/mutateState.js';
import { asRecord, err, ok } from './toolRegistry.js';
import type { Tool } from './toolRegistry.js';

export const adjustHpTool: Tool = {
  name: 'adjust_hp',
  description:
    "Adjust the character's current hit points by a signed amount. " +
    'Positive heals, negative damages. Clamped to [0, hp_max].',
  inputSchema: {
    type: 'object',
    properties: {
      amount: {
        type: 'integer',
        description: 'Signed integer: positive to heal, negative to damage.',
      },
    },
    required: ['amount'],
    additionalProperties: false,
  },
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.amount !== 'number') {
      return err('invalid_args', 'adjust_hp requires { amount: integer }');
    }
    try {
      const result = adjustHp(ctx.db, a.amount, {
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
