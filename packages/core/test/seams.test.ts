import { describe, expect, it } from 'vitest';
import { SEAMS } from '../src/seams.js';

describe('component seams', () => {
  it('enumerates the six seams filled by sub-epics E1-E7', () => {
    expect([...SEAMS].sort()).toEqual(
      [
        'ContextAssembler',
        'MemorySubsystem',
        'Orchestrator',
        'Persistence',
        'ToolLayer',
        'WorldSubsystem',
      ].sort(),
    );
  });
});
