import { memoryDrilldown } from '../memory/summary.js';
import type { MemoryDrilldownSelector } from '../memory/summary.js';
import { asRecord, err, ok } from './toolRegistry.js';
import type { Tool } from './toolRegistry.js';

export const memoryDrilldownTool: Tool = {
  name: 'memory_drilldown',
  description:
    'Drill into an omitted scene_log window or older scene/session/arc ' +
    'summary excluded from the bounded prompt. args: a MemoryDrilldownSelector.',
  run(args, ctx) {
    const a = asRecord(args);
    if (a === undefined || typeof a.target !== 'string') {
      return err('invalid_args', 'memory_drilldown requires a selector');
    }
    const result = memoryDrilldown(
      ctx.db,
      a as unknown as MemoryDrilldownSelector,
    );
    if (result === undefined) {
      return err('not_found', 'no memory record for that selector');
    }
    return ok(result);
  },
};
