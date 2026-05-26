// Component seams. Interfaces are intentionally empty in E0; sub-epics fill them:
//   Persistence       - E0/E3 data access
//   WorldSubsystem    - E2 module template + overlay
//   MemorySubsystem   - E4 pyramid + drill-down
//   ToolLayer         - E5 deterministic tools
//   ContextAssembler  - E5 bounded prompt assembly
//   Orchestrator      - E5 turn loop

export type Persistence = {};
export type WorldSubsystem = {};
export type MemorySubsystem = {};
export type ToolLayer = {};
export type ContextAssembler = {};
export type Orchestrator = {};

// Runtime witness so the seam set is testable and discoverable.
export const SEAMS = [
  'Persistence',
  'WorldSubsystem',
  'MemorySubsystem',
  'ToolLayer',
  'ContextAssembler',
  'Orchestrator',
] as const;

export type SeamName = (typeof SEAMS)[number];
