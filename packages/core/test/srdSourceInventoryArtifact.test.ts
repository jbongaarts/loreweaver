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

interface AmbiguousNameCollision {
  readonly normalizedName: string;
  readonly winnerKey: string;
  readonly shadowedKeys: readonly string[];
}

interface CollapsedSourceGroup {
  readonly text: string;
  readonly resolvedKey: string;
  readonly count: number;
}

interface CoverageReport {
  readonly summary: {
    readonly record: number;
    readonly childOf: number;
    readonly ignored: Readonly<Record<string, number>>;
    readonly knownGap: Readonly<Record<string, number>>;
    readonly unaccounted: number;
  };
  readonly ambiguous: {
    readonly shadowedRecords: readonly AmbiguousNameCollision[];
    readonly collapsedSourceItems: readonly CollapsedSourceGroup[];
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

  it('pins the exact coverage baseline so silent reclassification fails loudly', () => {
    // A tight baseline: regenerating the artifacts can keep `unaccounted === 0`
    // while quietly moving a covered structure into a broad known-gap rule
    // (notably the class-chapter fallback `known-gap:eshyra-4a7.6`). The
    // integrity checks above would miss that; these exact counts will not.
    // When an eshyra-4a7.* gap bead lands and regenerates the artifacts, update
    // these numbers in the same change that removes the matching curation rule.
    expect(inventory).toHaveLength(2258);
    // record 1849 -> 1873 (eshyra-4a7.3): the 24 document-wide table records
    // claim their captions / caption-less runs. The eshyra-4a7.3 catch-all
    // known-gap rule is gone; its remaining items moved to scoped owners —
    // the 26 still-flattened Magic-Items-chapter embedded tables joined
    // Figurine of Wondrous Power under eshyra-4a7.8 (1 -> 27), the 9
    // spell-embedded tables are tracked by eshyra-o4j7, and the deity tables
    // (5 items), Half-Dragon Template tables (2), and the Self-Sufficiency
    // prose sidebar (1) joined their regions under eshyra-4a7.10 (62 -> 70).
    // eshyra-4a7.6 dropped 128 -> 116 (the Barbarian progression caption,
    // seven Circle of the Land tables, Life Domain / Oath of Devotion /
    // Fiend Expanded spell tables, and Creating Spell Slots are now records);
    // eshyra-4a7.7's two Draconic Ancestry captions are now records, so its
    // rule was removed per the known-gap lifecycle.
    expect(coverage.summary.record).toBe(1873);
    expect(coverage.summary.childOf).toBe(12);
    expect(coverage.summary.unaccounted).toBe(0);
    expect(coverage.summary.ignored).toEqual({
      'document-structure': 41,
      'equipment-category-heading': 3,
      'front-matter': 2,
      'record-group-heading': 3,
      'spell-list-header': 78,
      'table-rows-emitted-as-records': 18,
      'variant-rule-excluded': 2,
    });
    expect(coverage.summary.knownGap).toEqual({
      'eshyra-4a7.4': 2,
      'eshyra-4a7.5': 2,
      'eshyra-4a7.6': 116,
      'eshyra-4a7.8': 27,
      'eshyra-4a7.10': 70,
      'eshyra-o4j7': 9,
    });
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

  it('the Ring of Resistance embedded d10 table (p237) is a caption-less table run tracked by eshyra-4a7.8', () => {
    const entry = entryFor(237, 'd10 Damage Type Gem');
    expect(entry.structure).toBe('table-shape');
    expect(entry.status).toBe('known-gap:eshyra-4a7.8');
  });

  it('the Carpet of Flying embedded size table (p213) is tracked by eshyra-4a7.8', () => {
    const entry = entryFor(213, 'd100 Size Capacity Flying Speed');
    expect(entry.structure).toBe('table-shape');
    expect(entry.status).toBe('known-gap:eshyra-4a7.8');
  });

  it('the Teleport familiarity matrix (p186) is a spell-embedded table tracked by eshyra-o4j7', () => {
    const entry = entryFor(186, 'Similar Off On');
    expect(entry.structure).toBe('table-shape');
    expect(entry.status).toBe('known-gap:eshyra-o4j7');
  });

  it('the Celtic Deities table (p360) belongs to the Appendix PH-B region tracked by eshyra-4a7.10', () => {
    const entry = entryFor(360, 'Celtic Deities');
    expect(entry.structure).toBe('table-caption');
    expect(entry.status).toBe('known-gap:eshyra-4a7.10');
  });

  it('the Half-Dragon Template tables (p320-321) belong to the template region tracked by eshyra-4a7.10', () => {
    const colors = entryFor(320, 'Color Damage Resistance');
    expect(colors.structure).toBe('table-shape');
    expect(colors.status).toBe('known-gap:eshyra-4a7.10');
    const sizes = entryFor(321, 'Optional');
    expect(sizes.structure).toBe('table-shape');
    expect(sizes.status).toBe('known-gap:eshyra-4a7.10');
  });

  it('the Self-Sufficiency prose sidebar (p73, table-shaped by typography) is tracked by eshyra-4a7.10', () => {
    const entry = entryFor(73, 'Self-Sufficiency');
    expect(entry.structure).toBe('table-caption');
    expect(entry.status).toBe('known-gap:eshyra-4a7.10');
  });
});

describe('committed SRD source-coverage artifacts — ambiguous-match diagnostic (eshyra-xwic)', () => {
  it('artifact carries an ambiguous section with shadowedRecords and collapsedSourceItems', () => {
    expect(coverage.ambiguous).toBeDefined();
    expect(Array.isArray(coverage.ambiguous.shadowedRecords)).toBe(true);
    expect(Array.isArray(coverage.ambiguous.collapsedSourceItems)).toBe(true);
  });

  it('pins exact ambiguous-match counts so silent drift fails loudly', () => {
    // When a bead closes a name collision (e.g. by adding an explicit
    // recordRule that disambiguates a duplicate, or by renaming a record),
    // these counts should drop and the test should be updated in the same change.
    expect(coverage.ambiguous.shadowedRecords).toHaveLength(62);
    expect(coverage.ambiguous.collapsedSourceItems).toHaveLength(60);
  });

  it('surfaces the 12-way Ability Score Improvement feature collapse (one per class, all map to barbarian key)', () => {
    const asi = coverage.ambiguous.collapsedSourceItems.find(
      (g) => g.resolvedKey === 'feature:barbarian:ability-score-improvement',
    );
    expect(asi).toBeDefined();
    expect(asi?.text).toBe('Ability Score Improvement');
    expect(asi?.count).toBe(12);
  });

  it('surfaces the Acolyte cross-kind collision (background and creature share the same name)', () => {
    const shadow = coverage.ambiguous.shadowedRecords.find(
      (r) => r.normalizedName === 'acolyte',
    );
    expect(shadow).toBeDefined();
    expect(shadow?.winnerKey).toBe('background:acolyte');
    expect(shadow?.shadowedKeys).toContain('creature:acolyte');
  });

  it('surfaces the Actions collapse (monster stat-block sections all map to the rule:actions key)', () => {
    const actions = coverage.ambiguous.collapsedSourceItems.find(
      (g) => g.resolvedKey === 'rule:actions',
    );
    expect(actions).toBeDefined();
    expect(actions?.text).toBe('Actions');
    // 296 creature + 21 NPC stat blocks each have an Actions section; the
    // exact count may change as the monster chapter parser evolves. Gate on
    // a minimum so a regression that drops entries fails, not the exact value.
    expect(actions?.count).toBeGreaterThanOrEqual(300);
  });

  it('shadowedRecords entries are sorted by normalizedName', () => {
    const names = coverage.ambiguous.shadowedRecords.map(
      (r) => r.normalizedName,
    );
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it('collapsedSourceItems entries are sorted by resolvedKey', () => {
    const keys = coverage.ambiguous.collapsedSourceItems.map(
      (g) => g.resolvedKey,
    );
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
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

  it('the duplicate Draconic Ancestry captions (p5 Races, p44 Sorcerer) resolve to their OWN table records', () => {
    // Both captions print the same text, so the name auto-match alone cannot
    // tell them apart; explicit per-chapter record rules (which outrank the
    // auto-match) map each caption to its own emitted record (eshyra-4a7.3).
    const races = entryFor(5, 'Draconic Ancestry');
    expect(races.structure).toBe('table-caption');
    expect(races.status).toBe('record:table:draconic-ancestry');
    const sorcerer = entryFor(44, 'Draconic Ancestry');
    expect(sorcerer.structure).toBe('table-caption');
    expect(sorcerer.status).toBe(
      'record:table:draconic-bloodline-draconic-ancestry',
    );
  });

  it('the Barbarian progression caption (p8) resolves to the emitted table record', () => {
    const entry = entryFor(8, 'The Barbarian');
    expect(entry.structure).toBe('table-caption');
    expect(entry.status).toBe('record:table:the-barbarian');
  });

  it('the bare Circle of the Land terrain captions (p22) resolve to their qualified table records', () => {
    const arctic = entryFor(22, 'Arctic');
    expect(arctic.structure).toBe('table-caption');
    expect(arctic.status).toBe('record:table:circle-of-the-land-arctic');
    const swamp = entryFor(22, 'Swamp');
    expect(swamp.status).toBe('record:table:circle-of-the-land-swamp');
  });

  it('caption-less magic-item table runs resolve to their owning-item-named table records', () => {
    const wand = entryFor(250, 'd100 Effect');
    expect(wand.structure).toBe('table-shape');
    expect(wand.status).toBe('record:table:wand-of-wonder');
    const beans = entryFor(209, 'd100 Effect');
    expect(beans.status).toBe('record:table:bag-of-beans');
    const belt = entryFor(211, 'Type Strength Rarity');
    expect(belt.status).toBe('record:table:belt-of-giant-strength');
  });

  it('the Donning and Doffing Armor caption (p64) resolves to the emitted table record', () => {
    const entry = entryFor(64, 'Donning and Doffing Armor');
    expect(entry.structure).toBe('table-caption');
    expect(entry.status).toBe('record:table:donning-and-doffing-armor');
  });
});
