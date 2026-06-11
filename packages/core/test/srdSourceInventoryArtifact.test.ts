/**
 * Sentinel regression tests for the committed SRD source-coverage artifacts
 * (eshyra-4a7.1) at `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/`.
 *
 * Like `srdGeneratedPack.test.ts`, these tests operate on the COMMITTED
 * artifacts on disk, not on importer output — re-running the importer is the
 * path-gated `verify:dnd5e-srd-pack` job's responsibility. What this file
 * guards:
 *
 *   - The artifacts exist, parse, and are internally consistent (every
 *     inventory item has exactly one coverage entry; nothing unaccounted).
 *   - The known structure gaps the eshyra-4a7 epic is built around are
 *     VISIBLE in the coverage output as `known-gap:<bead>` statuses rather
 *     than hidden inside passing tests — when one of those beads lands and
 *     regenerates the artifacts, the matching sentinel here fails on purpose
 *     so the curation rule gets removed and the gate starts enforcing the
 *     new coverage.
 *   - Source structures the pack genuinely covers resolve to `record:` /
 *     `child-of:` statuses.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PACK_DIR = join(
  process.cwd(),
  'packages/core/data/rules-packs/rules__dnd5e-srd-5.1',
);

interface InventoryItem {
  readonly page: number;
  readonly lineIndex: number;
  readonly text: string;
  readonly tier: string | null;
  readonly structure: string;
  readonly section: string | null;
  readonly context: string | null;
}

interface CoverageEntry {
  readonly page: number;
  readonly lineIndex: number;
  readonly tier: string | null;
  readonly structure: string;
  readonly text: string;
  readonly section: string | null;
  readonly status: string;
}

interface CoverageReport {
  readonly summary: {
    readonly record: number;
    readonly childOf: number;
    readonly ignored: Readonly<Record<string, number>>;
    readonly knownGap: Readonly<Record<string, number>>;
    readonly unaccounted: number;
  };
  readonly entries: readonly CoverageEntry[];
}

const inventory = JSON.parse(
  readFileSync(join(PACK_DIR, 'source-inventory.json'), 'utf8'),
) as readonly InventoryItem[];

const coverage = JSON.parse(
  readFileSync(join(PACK_DIR, 'source-coverage.json'), 'utf8'),
) as CoverageReport;

/** The unique coverage entry for a (page, text) pair; throws if ambiguous. */
function entryFor(page: number, text: string): CoverageEntry {
  const matches = coverage.entries.filter(
    (e) => e.page === page && e.text === text,
  );
  expect(
    matches,
    `expected exactly one entry for p${page} "${text}"`,
  ).toHaveLength(1);
  return matches[0];
}

describe('committed SRD source-coverage artifacts — integrity', () => {
  it('inventory and coverage describe the same item set in reading order', () => {
    expect(inventory.length).toBeGreaterThan(2000);
    expect(coverage.entries).toHaveLength(inventory.length);
    const locator = (x: { page: number; lineIndex: number }) =>
      `${x.page}:${x.lineIndex}`;
    expect(coverage.entries.map(locator)).toEqual(inventory.map(locator));
    // Reading order: sorted by (page, lineIndex).
    const sorted = [...inventory].sort(
      (a, b) => a.page - b.page || a.lineIndex - b.lineIndex,
    );
    expect(inventory.map(locator)).toEqual(sorted.map(locator));
  });

  it('accounts for every source structure (the gate is closed)', () => {
    expect(coverage.summary.unaccounted).toBe(0);
    expect(
      coverage.entries.filter((e) => e.status === 'unaccounted'),
    ).toHaveLength(0);
  });

  it('summary counts match the entries', () => {
    const counted =
      coverage.summary.record +
      coverage.summary.childOf +
      coverage.summary.unaccounted +
      Object.values(coverage.summary.ignored).reduce((a, b) => a + b, 0) +
      Object.values(coverage.summary.knownGap).reduce((a, b) => a + b, 0);
    expect(counted).toBe(coverage.entries.length);
  });

  it('every known-gap status names an eshyra bead', () => {
    for (const beadId of Object.keys(coverage.summary.knownGap)) {
      expect(beadId).toMatch(/^eshyra-/);
    }
  });
});

describe('committed SRD source-coverage artifacts — known-gap sentinels', () => {
  it('Figurine of Wondrous Power (p221, swallowed by Feather Token) is tracked by eshyra-4a7.8', () => {
    const entry = entryFor(221, 'Figurine of Wondrous Power');
    expect(entry.status).toBe('known-gap:eshyra-4a7.8');
  });

  it('embedded stat blocks Avatar of Death (p218) and Giant Fly (p222) are classified and tracked by eshyra-4a7.4', () => {
    const avatar = entryFor(218, 'Avatar of Death');
    expect(avatar.structure).toBe('stat-block');
    expect(avatar.status).toBe('known-gap:eshyra-4a7.4');
    const fly = entryFor(222, 'Giant Fly');
    expect(fly.structure).toBe('stat-block');
    expect(fly.status).toBe('known-gap:eshyra-4a7.4');
  });

  it('the Dragonborn Draconic Ancestry table (p5) is a table caption tracked by eshyra-4a7.7', () => {
    const entry = entryFor(5, 'Draconic Ancestry');
    expect(entry.structure).toBe('table-caption');
    expect(entry.status).toBe('known-gap:eshyra-4a7.7');
  });

  it('the Barbarian class progression table (p8) is a table caption tracked by eshyra-4a7.6', () => {
    const entry = entryFor(8, 'The Barbarian');
    expect(entry.structure).toBe('table-caption');
    expect(entry.status).toBe('known-gap:eshyra-4a7.6');
  });

  it('the Ring of Resistance embedded d10 table (p237) is a caption-less table run tracked by eshyra-4a7.3', () => {
    const entry = entryFor(237, 'd10 Damage Type Gem');
    expect(entry.structure).toBe('table-shape');
    expect(entry.status).toBe('known-gap:eshyra-4a7.3');
  });
});

describe('committed SRD source-coverage artifacts — covered-structure sentinels', () => {
  it('the Champion subclass feature heading Improved Critical (p25) resolves to its feature record', () => {
    const entry = entryFor(25, 'Improved Critical');
    expect(entry.status).toBe('record:feature:champion:improved-critical');
  });

  it('the bare "Lightfoot" subrace heading (p5) maps to the renamed ancestry record', () => {
    const entry = entryFor(5, 'Lightfoot');
    expect(entry.status).toBe('record:ancestry:lightfoot-halfling');
  });

  it('race trait subsections resolve as child data on ancestry records', () => {
    const entry = entryFor(3, 'Dwarf Traits');
    expect(entry.status).toBe('child-of:ancestry:dwarf');
  });
});
