import type { WorldQueryTarget } from '../world/types.js';
import { worldQuery } from '../world/worldQuery.js';
import { asRecord, err, ok } from './toolRegistry.js';
import type { Tool } from './toolRegistry.js';

export const worldQueryTool: Tool = {
  name: 'world_query',
  description:
    'Resolve a world target (template + live overlay). ' +
    'args: { type: "location"|"encounter"|"npc"|"lore"|"meta", id?: string }.',
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.type !== 'string') {
      return err('invalid_args', 'world_query requires { type, id? }');
    }
    const result = worldQuery(ctx.db, a as unknown as WorldQueryTarget);
    if (result.ok) {
      return ok(result);
    }
    return err(result.code, result.message);
  },
};
