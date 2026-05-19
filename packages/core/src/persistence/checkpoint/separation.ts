import { resolve, relative, isAbsolute } from 'node:path';

export const BEADS_RESERVED_REF = 'refs/dolt/data';

export class SeparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeparationError';
  }
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function assertSeparateFromBeads(
  doltDir: string,
  beadsDir: string,
): void {
  const a = resolve(doltDir);
  const b = resolve(beadsDir);
  if (a === b || isInside(a, b) || isInside(b, a)) {
    throw new SeparationError(
      `Loreweaver Dolt dir ${a} must be disjoint from beads Dolt dir ${b}`,
    );
  }
}
