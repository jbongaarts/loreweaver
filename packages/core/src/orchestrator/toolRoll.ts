import { DiceError, rollDice } from './dice.js';
import { asRecord, err, ok } from './toolRegistry.js';
import type { Tool } from './toolRegistry.js';

export const rollTool: Tool = {
  name: 'roll',
  description:
    'Roll dice with code-owned RNG. args: { dice: "NdM+K", reason: string }.',
  run(args, ctx) {
    const a = asRecord(args);
    if (
      a === undefined ||
      typeof a.dice !== 'string' ||
      typeof a.reason !== 'string' ||
      a.reason.length === 0
    ) {
      return err(
        'invalid_args',
        'roll requires { dice: string, reason: string }',
      );
    }
    try {
      const roll = rollDice(a.dice, ctx.rng);
      return ok({
        dice: a.dice,
        reason: a.reason,
        rolls: roll.rolls,
        modifier: roll.modifier,
        total: roll.total,
      });
    } catch (e) {
      if (e instanceof DiceError) {
        return err('invalid_dice', e.message);
      }
      throw e;
    }
  },
};
