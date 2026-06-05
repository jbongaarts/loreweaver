/**
 * Default-on coverage and audit tests for the committed D&D 5e SRD 5.1
 * rules-pack at `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/`.
 *
 * These tests operate on the COMMITTED pack on disk — not on importer output.
 * Per the 0m9.6 design, the importer is treated as a one-shot construction
 * tool. Continuously re-running it on every PR is the path-gated
 * `verify:dnd5e-srd-pack` job's responsibility, not vitest's.
 *
 * What this file guards:
 *   - The committed pack still loads and validates.
 *   - Per-kind counts match the canonical full-pack baseline literal
 *     (loreweaver-1pw replaced the two-record seed pack with the importer's
 *     full deterministic output from the vendored SRD 5.1 PDF).
 *   - Key shape is consistent and unique.
 *   - A representative stable key from every kind is present.
 *   - The generic `auditPack` heuristic surfaces no suspicious records, and the
 *     set of partially-populated optional data fields matches an explicitly
 *     reviewed baseline (these are genuinely-optional SRD fields — e.g. a spell
 *     `ritual` flag or an ancestry `subraces` list — present on some records of
 *     a kind and absent on others, not parser drift).
 *   - The pack's license/source manifest aligns with the vendored source
 *     manifest at `packages/core/sources/dnd5e-srd-5.1/manifest.json`.
 *
 * Out of scope (see bead notes):
 *   - Exact creature name-set validation → `loreweaver-0m9.5.14`.
 *   - Pathfinder coverage → `loreweaver-0m9.9`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXPECTED_SRD_5_1_CREATURE_NAMES,
  EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES,
  EXPECTED_SRD_5_1_NPC_NAMES,
  MIN_EXPECTED_SRD_5_1_CREATURES,
  MIN_EXPECTED_SRD_5_1_MAGIC_ITEMS,
} from '../scripts/importers/dnd5e-srd-5.1/index.js';
import {
  auditPack,
  loadRulesPackFromDirectory,
  validateRulesPack,
} from '../src/internal.js';

const PACK_DIR = join(
  process.cwd(),
  'packages/core/data/rules-packs/rules__dnd5e-srd-5.1',
);

const SOURCE_MANIFEST_PATH = join(
  process.cwd(),
  'packages/core/sources/dnd5e-srd-5.1/manifest.json',
);

interface SrdSourceManifest {
  readonly sourceTitle: string;
  readonly sourceVersion: string;
  readonly license: {
    readonly name: string;
    readonly url: string;
  };
  readonly artifact: {
    readonly sourceUrl: string;
    readonly sha256: string;
  };
  readonly attribution: {
    readonly text: string;
  };
}

function readSourceManifest(): SrdSourceManifest {
  return JSON.parse(
    readFileSync(SOURCE_MANIFEST_PATH, 'utf8'),
  ) as SrdSourceManifest;
}

/**
 * Per-kind record-count baseline for the committed canonical pack at
 * `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/`. These are the exact
 * per-kind counts the deterministic importer produces from the vendored
 * SRD 5.1 PDF (loreweaver-1pw); `npm run verify:dnd5e-srd-pack` proves the
 * committed pack equals importer output byte-for-byte.
 *
 * The match is exact: the test fails if a kind appears or disappears, or any
 * count drifts. That's the regression-guard intent — accidental edits to the
 * committed pack, or an importer/parser change that silently alters coverage,
 * do not slip through unnoticed. An intentional coverage change updates this
 * literal (and re-runs the verify command) as part of that change.
 */
const EXPECTED_COUNTS_BY_KIND: Readonly<Record<string, number>> = {
  action: 10,
  ancestry: 13,
  class: 12,
  condition: 15,
  // 296 Monsters/Appendix MM-A creatures + 21 Appendix MM-B NPC stat blocks,
  // all under the `creature` kind; NPCs carry data.category='npc'
  // (loreweaver-bn0). The two coverage sets are validated independently below.
  creature: 317,
  equipment: 218,
  feat: 1,
  feature: 144,
  // The 8 SRD 5.1 sample traps emit under the `hazard` kind (loreweaver-hvp);
  // SRD 5.1 has no environmental hazards, so all 8 hazard records are traps.
  hazard: 8,
  'magic-item': 236,
  rule: 10,
  spell: 319,
  subclass: 12,
  // Difficulty Classes + the two trap reference tables (loreweaver-hvp).
  table: 3,
};

/**
 * One representative stable key per kind that must be present in the committed
 * pack — a coarse spot-check that the parse for each kind produced its expected
 * landmark records. Exact full-set coverage per kind lives in the importer's
 * own coverage gates and per-parser tests, not here.
 */
const EXPECTED_STABLE_KEYS: readonly string[] = [
  'action:dodge',
  'ancestry:elf',
  'ancestry:hill-dwarf',
  'class:wizard',
  'condition:blinded',
  'condition:exhaustion',
  'creature:goblin',
  'creature:aboleth',
  // Appendix MM-B NPC stat blocks (loreweaver-bn0).
  'creature:bandit-captain',
  'creature:berserker',
  'equipment:padded',
  'equipment:longsword',
  'equipment:smiths-tools',
  'feat:grappler',
  'feature:champion:improved-critical',
  'hazard:fire-breathing-statue',
  'hazard:sphere-of-annihilation',
  'magic-item:adamantine-armor',
  'magic-item:ammunition-1-2-or-3',
  'magic-item:amulet-of-health',
  'rule:difficult-terrain',
  'spell:fire-bolt',
  'spell:wish',
  'subclass:champion',
  'table:difficulty-classes',
  'table:trap-save-dcs-and-attack-bonuses',
];

/**
 * Reviewed baseline of partially-populated optional `data` fields — fields
 * present on some records of a kind and absent on others. Each entry here was
 * reviewed (loreweaver-1pw) and is a genuinely-optional SRD field, NOT a
 * parser-drift signal:
 *   - ancestry.subraceOf / subraces: only subraces carry `subraceOf`; only
 *     races-with-subraces carry `subraces`.
 *   - creature.category: only the 21 Appendix MM-B NPC stat blocks carry
 *     `category: 'npc'`; the 296 Monsters/Appendix MM-A creatures omit it (its
 *     absence means "monster") so they stay byte-identical to the pre-NPC pack
 *     (loreweaver-bn0).
 *   - condition.effects: present on all conditions except Exhaustion, whose
 *     mechanics live in its per-level `levels` table.
 *   - condition.levels: only Exhaustion has graded levels.
 *   - equipment.{ac,armorType,stealthDisadvantage,strengthRequirement}: armor-
 *     only fields (13 armor records); strengthRequirement only the 3 heavy
 *     armors that list a Str minimum.
 *   - equipment.{damageDie,damageType,properties}: weapon-only fields (37
 *     weapons); damageDie/damageType absent on the Net, whose damage cell is a
 *     dash, while every weapon carries a (possibly empty) properties list.
 *   - equipment.capacity: Container Capacity, attached to the 13 gear
 *     containers (loreweaver-4zu).
 *   - equipment.{speed,carryingCapacity}: Mounts and Vehicles fields —
 *     `speed` on the 8 mounts + 6 waterborne vehicles (14), `carryingCapacity`
 *     on the 8 mounts only (loreweaver-4zu).
 *   - equipment.description: the 7 Equipment Pack bundles (their verbatim
 *     contents sentence); no other equipment record carries a description
 *     (loreweaver-4zu).
 *   - equipment.weight: absent on the 44 records the SRD lists with no weight
 *     cell — the items with a "—" weight (Sling, gaming sets, and many
 *     adventuring-gear/tack rows) plus the 7 packs, 8 mounts, and 6 waterborne
 *     vehicles (priced by speed/capacity, not weight).
 *   - magic-item.attunementRequirement: only the 19 items whose category line
 *     restricts attunement by class, ancestry, alignment, or spellcasting carry
 *     this text; all 236 records still carry the boolean `requiresAttunement`.
 *   - spell.componentMaterials: only spells with a material (M) component.
 *   - spell.higherLevels: only spells with an "At Higher Levels" entry.
 *   - spell.ritual: only spells tagged as rituals.
 * The audit reports `0 < missingCount < totalInKind` per field; we pin the
 * compact {kind, field, missingCount, totalInKind} projection so a new
 * partially-populated field (a real drift signal) fails the test, while the
 * long `affectedKeys` lists stay out of the baseline to keep it maintainable.
 */
const EXPECTED_PARTIAL_FIELDS: ReadonlyArray<{
  readonly kind: string;
  readonly field: string;
  readonly missingCount: number;
  readonly totalInKind: number;
}> = [
  { kind: 'ancestry', field: 'subraceOf', missingCount: 9, totalInKind: 13 },
  { kind: 'ancestry', field: 'subraces', missingCount: 9, totalInKind: 13 },
  { kind: 'condition', field: 'effects', missingCount: 1, totalInKind: 15 },
  { kind: 'condition', field: 'levels', missingCount: 14, totalInKind: 15 },
  // Only Appendix MM-B NPC creatures carry data.category='npc' (21 of 317);
  // monster creatures intentionally omit it (loreweaver-bn0). Ordered after
  // `condition` because auditPack sorts the summary by kind.
  { kind: 'creature', field: 'category', missingCount: 296, totalInKind: 317 },
  { kind: 'equipment', field: 'ac', missingCount: 205, totalInKind: 218 },
  {
    kind: 'equipment',
    field: 'armorType',
    missingCount: 205,
    totalInKind: 218,
  },
  { kind: 'equipment', field: 'capacity', missingCount: 205, totalInKind: 218 },
  {
    kind: 'equipment',
    field: 'carryingCapacity',
    missingCount: 210,
    totalInKind: 218,
  },
  {
    kind: 'equipment',
    field: 'damageDie',
    missingCount: 182,
    totalInKind: 218,
  },
  {
    kind: 'equipment',
    field: 'damageType',
    missingCount: 182,
    totalInKind: 218,
  },
  {
    kind: 'equipment',
    field: 'description',
    missingCount: 211,
    totalInKind: 218,
  },
  {
    kind: 'equipment',
    field: 'properties',
    missingCount: 181,
    totalInKind: 218,
  },
  { kind: 'equipment', field: 'speed', missingCount: 204, totalInKind: 218 },
  {
    kind: 'equipment',
    field: 'stealthDisadvantage',
    missingCount: 205,
    totalInKind: 218,
  },
  {
    kind: 'equipment',
    field: 'strengthRequirement',
    missingCount: 215,
    totalInKind: 218,
  },
  { kind: 'equipment', field: 'weight', missingCount: 44, totalInKind: 218 },
  {
    kind: 'magic-item',
    field: 'attunementRequirement',
    missingCount: 217,
    totalInKind: 236,
  },
  {
    kind: 'spell',
    field: 'componentMaterials',
    missingCount: 135,
    totalInKind: 319,
  },
  { kind: 'spell', field: 'higherLevels', missingCount: 227, totalInKind: 319 },
  { kind: 'spell', field: 'ritual', missingCount: 290, totalInKind: 319 },
];

// `<kind>:<kebab-slug>` with one or more colon-separated slug segments. Kinds
// may be hyphenated (`magic-item:adamantine-armor`); class/subclass-scoped
// features namespace the slug (`feature:bard:ability-score-improvement`).
const KEY_PATTERN = /^[a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)+$/;

/**
 * PDF hyphen-cluster artifacts that must NOT survive into the durable pack.
 * The SRD 5.1 PDF font renders every word-internal hyphen as an ASCII hyphen
 * wrapped in invisible presentation hyphens (U+00AD SOFT HYPHEN, U+2010 HYPHEN,
 * U+2011 NON-BREAKING HYPHEN). The extractor collapses those clusters to a lone
 * ASCII hyphen (`normalizePdfHyphenCluster` in the importer's `extract.ts`), so
 * a regenerated canonical pack must contain none of these code points
 * (loreweaver-6uy). The class is written with explicit `\uXXXX` escapes so this
 * test source embeds no invisible characters; en-dash (U+2013) and em-dash
 * (U+2014) are legitimate SRD punctuation and intentionally excluded.
 */
const FORBIDDEN_HYPHEN_CODE_POINTS: ReadonlyArray<{
  readonly name: string;
  readonly codePoint: number;
}> = [
  { name: 'U+00AD SOFT HYPHEN', codePoint: 0x00ad },
  { name: 'U+2010 HYPHEN', codePoint: 0x2010 },
  { name: 'U+2011 NON-BREAKING HYPHEN', codePoint: 0x2011 },
];

describe('D&D 5e SRD 5.1 committed pack', () => {
  const pack = loadRulesPackFromDirectory(PACK_DIR);

  describe('schema validity', () => {
    it('loads and re-validates without error', () => {
      // `loadRulesPackFromDirectory` already ran validateRulesPack; re-running
      // on the loaded object asserts the in-memory pack is still well-formed
      // (no shared mutation introduced by an upstream helper).
      expect(() => validateRulesPack(pack)).not.toThrow();
    });

    it('declares the canonical packId for D&D 5e SRD 5.1', () => {
      expect(pack.meta.packId).toBe('rules:dnd5e-srd-5.1');
      expect(pack.meta.systemId).toBe('dnd5e-srd');
      expect(pack.meta.version).toBe('5.1');
      expect(pack.meta.role).toBe('base');
    });
  });

  describe('category counts', () => {
    it('per-kind counts exactly match the documented baseline', () => {
      const audit = auditPack(pack);
      expect(audit.countsByKind).toEqual(EXPECTED_COUNTS_BY_KIND);
    });

    it('total record count matches the sum of per-kind counts', () => {
      const expectedTotal = Object.values(EXPECTED_COUNTS_BY_KIND).reduce(
        (sum, n) => sum + n,
        0,
      );
      expect(pack.records).toHaveLength(expectedTotal);
    });
  });

  describe('record keys', () => {
    it('every key matches the `<kind>:<kebab-slug>` shape', () => {
      for (const record of pack.records) {
        expect(record.key).toMatch(KEY_PATTERN);
      }
    });

    it('every key begins with its own record kind as the prefix', () => {
      for (const record of pack.records) {
        const [prefix] = record.key.split(':');
        expect(prefix).toBe(record.kind);
      }
    });

    it('all keys are unique within the pack', () => {
      const keys = pack.records.map((record) => record.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('contains the documented set of stable spot-check keys', () => {
      const keys = new Set(pack.records.map((record) => record.key));
      for (const expected of EXPECTED_STABLE_KEYS) {
        expect(keys.has(expected)).toBe(true);
      }
    });
  });

  // `EXPECTED_SRD_5_1_CREATURE_NAMES` (loreweaver-0m9.5.14) is a reviewed,
  // checked-in baseline — a candidate generated from the vendored PDF, reviewed
  // against the SRD source, then committed (see its doc comment and
  // `npm run generate:dnd5e-srd-creature-names`). This test does NOT derive the
  // expected names at runtime: it compares the committed pack's creature record
  // names against that fixed baseline. Its purpose is regression protection —
  // not a standalone proof of SRD completeness. Once the reviewed baseline is
  // committed, a parser change that drops, adds, or renames a creature record
  // breaks this test until the baseline is regenerated, re-reviewed, and updated
  // in the same change.
  describe('creature name-set regression baseline (loreweaver-0m9.5.14)', () => {
    const creatureRecords = pack.records.filter(
      (record) => record.kind === 'creature',
    );
    // Monster vs NPC are distinguished by the data.category discriminator:
    // only Appendix MM-B NPC records carry category='npc' (loreweaver-bn0).
    const isNpc = (record: (typeof creatureRecords)[number]): boolean =>
      (record.data as { category?: unknown }).category === 'npc';
    const monsterNames = creatureRecords
      .filter((record) => !isNpc(record))
      .map((record) => record.name);
    const npcNames = creatureRecords
      .filter((record) => isNpc(record))
      .map((record) => record.name);

    it('committed pack monster-creature names match the checked-in baseline exactly', () => {
      expect([...monsterNames].sort()).toEqual(
        [...EXPECTED_SRD_5_1_CREATURE_NAMES].sort(),
      );
    });

    it('committed pack NPC-creature names match the checked-in baseline exactly', () => {
      expect([...npcNames].sort()).toEqual(
        [...EXPECTED_SRD_5_1_NPC_NAMES].sort(),
      );
    });

    it('EXPECTED_SRD_5_1_CREATURE_NAMES has no duplicates', () => {
      expect(new Set(EXPECTED_SRD_5_1_CREATURE_NAMES).size).toBe(
        EXPECTED_SRD_5_1_CREATURE_NAMES.length,
      );
    });

    it('EXPECTED_SRD_5_1_NPC_NAMES has no duplicates', () => {
      expect(new Set(EXPECTED_SRD_5_1_NPC_NAMES).size).toBe(
        EXPECTED_SRD_5_1_NPC_NAMES.length,
      );
    });

    it('no NPC name collides with a monster name (unique creature keyspace)', () => {
      const monsterSet = new Set(EXPECTED_SRD_5_1_CREATURE_NAMES);
      const collisions = EXPECTED_SRD_5_1_NPC_NAMES.filter((name) =>
        monsterSet.has(name),
      );
      expect(collisions).toEqual([]);
    });

    it('the monster + NPC baselines sum to the documented creature count', () => {
      // The monster name-set is the 296-creature baseline; the NPC name-set is
      // the 21 Appendix MM-B stat blocks. Together they are the `creature`
      // per-kind count (loreweaver-bn0).
      expect(EXPECTED_SRD_5_1_CREATURE_NAMES).toHaveLength(
        MIN_EXPECTED_SRD_5_1_CREATURES,
      );
      expect(
        EXPECTED_SRD_5_1_CREATURE_NAMES.length +
          EXPECTED_SRD_5_1_NPC_NAMES.length,
      ).toBe(EXPECTED_COUNTS_BY_KIND.creature);
    });
  });

  // loreweaver-ecr: Magic Items A-Z is a two-column section whose body text can
  // interleave item tables, bullets, and neighboring prose with item headings.
  // The importer pins the exact reviewed name set so table/prose text cannot be
  // silently promoted to a `magic-item` record, and recovered two-column ring /
  // staff entries cannot silently disappear.
  describe('magic-item name-set regression baseline (loreweaver-ecr)', () => {
    const magicItems = pack.records.filter(
      (record) => record.kind === 'magic-item',
    );

    function magicItemData(key: string): Record<string, unknown> {
      const record = magicItems.find((r) => r.key === key);
      expect(record, `expected ${key} in the committed pack`).toBeDefined();
      return record?.data as Record<string, unknown>;
    }

    it('committed pack magic-item names match the checked-in baseline exactly', () => {
      expect(magicItems.map((record) => record.name).sort()).toEqual(
        [...EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES].sort(),
      );
    });

    it('EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES has no duplicates', () => {
      expect(new Set(EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES).size).toBe(
        EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES.length,
      );
    });

    it('the magic-item baseline length matches the documented count', () => {
      expect(EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES).toHaveLength(
        MIN_EXPECTED_SRD_5_1_MAGIC_ITEMS,
      );
      expect(EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES.length).toBe(
        EXPECTED_COUNTS_BY_KIND['magic-item'],
      );
    });

    it('carries representative item type, rarity, attunement, and embedded table text', () => {
      expect(magicItemData('magic-item:adamantine-armor')).toMatchObject({
        itemType: 'Armor (medium or heavy, but not hide)',
        rarity: 'uncommon',
        requiresAttunement: false,
      });
      expect(magicItemData('magic-item:staff-of-power')).toMatchObject({
        itemType: 'Staff',
        rarity: 'very rare',
        requiresAttunement: true,
        attunementRequirement: 'by a sorcerer, warlock, or wizard',
      });
      const armorOfResistance = magicItemData('magic-item:armor-of-resistance');
      expect(armorOfResistance).toMatchObject({
        itemType: 'Armor (light, medium, or heavy)',
        rarity: 'rare',
        requiresAttunement: true,
      });
      expect(armorOfResistance.description).toContain('d10 Damage Type');
      expect(armorOfResistance.description).toContain('1 Acid 6 Necrotic');
    });
  });

  // loreweaver-3n6: the committed pack once collapsed to a single equipment
  // record (an inaccurate `equipment:padded`) because the equipment parser
  // assumed a row-major table layout the real SRD 5.1 PDF does not use — it
  // splits the Armor and Weapons tables into separate column-blocks. These
  // assertions guard the reconstructed per-category coverage so a parser
  // regression that drops a table (or collapses back to one record) fails here.
  describe('equipment coverage regression (loreweaver-3n6)', () => {
    const equipment = pack.records.filter((r) => r.kind === 'equipment');

    function category(key: string): string | undefined {
      const data = pack.records.find((r) => r.key === key)?.data as
        | { category?: unknown }
        | undefined;
      return typeof data?.category === 'string' ? data.category : undefined;
    }

    it('emits every reconstructed equipment category, not a single record', () => {
      const counts = new Map<string, number>();
      for (const record of equipment) {
        const cat = (record.data as { category?: unknown }).category;
        if (typeof cat === 'string') {
          counts.set(cat, (counts.get(cat) ?? 0) + 1);
        }
      }
      // The reviewed SRD 5.1 baseline (loreweaver-3n6 + loreweaver-4zu):
      // 13 armor, 37 weapons, 35 tools, 112 gear (99 Adventuring Gear + 13
      // Tack/Harness/Drawn Vehicles), 7 Equipment Packs, 8 mounts, 6 waterborne
      // vehicles.
      expect(Object.fromEntries(counts)).toEqual({
        armor: 13,
        weapon: 37,
        tool: 35,
        gear: 112,
        pack: 7,
        mount: 8,
        vehicle: 6,
      });
    });

    it('Padded armor matches the SRD armor table (stealth disadvantage + weight)', () => {
      const padded = pack.records.find((r) => r.key === 'equipment:padded');
      expect(padded?.data).toMatchObject({
        category: 'armor',
        cost: '5 gp',
        ac: '11 + Dex modifier',
        armorType: 'light',
        stealthDisadvantage: true,
        weight: '8 lb.',
      });
    });

    it('carries landmark records from each reconstructed table', () => {
      // One armor (heavy, with a strength requirement), one weapon (zipped
      // damage + weight + properties), and one tool.
      expect(category('equipment:plate')).toBe('armor');
      expect(category('equipment:longsword')).toBe('weapon');
      expect(category('equipment:smiths-tools')).toBe('tool');

      const longsword = pack.records.find(
        (r) => r.key === 'equipment:longsword',
      );
      expect(longsword?.data).toMatchObject({
        category: 'weapon',
        damageDie: '1d8',
        damageType: 'slashing',
        weight: '3 lb.',
        properties: ['Versatile (1d10)'],
      });
    });

    // loreweaver-4zu: the Adventuring Gear table is reconstructed from two
    // interleaved physical columns whose item names are fully separated from
    // their cost/weight cells; these spot-checks guard the deterministic
    // name↔value zip (a left-column item, a right-column item, a sub-item under
    // a category header, and a Container Capacity attachment).
    it('reconstructs Adventuring Gear cost/weight and container capacity', () => {
      // Left-column item (its value arrives interleaved with right-column rows).
      expect(category('equipment:backpack')).toBe('gear');
      expect(
        pack.records.find((r) => r.key === 'equipment:backpack')?.data,
      ).toMatchObject({
        category: 'gear',
        cost: '2 gp',
        weight: '5 lb.',
        capacity: '1 cubic foot/30 pounds of gear',
      });
      // Right-column complete row.
      expect(
        pack.records.find((r) => r.key === 'equipment:potion-of-healing')?.data,
      ).toMatchObject({ category: 'gear', cost: '50 gp', weight: '1/2 lb.' });
      // Sub-item under the "Arcane focus" category header (header itself has no
      // cost cell and must not become a record).
      expect(
        pack.records.find((r) => r.key === 'equipment:crystal')?.data,
      ).toMatchObject({ category: 'gear', cost: '10 gp', weight: '1 lb.' });
      expect(pack.records.some((r) => r.key === 'equipment:arcane-focus')).toBe(
        false,
      );
    });

    it('imports Mounts and Vehicles with per-table categories (loreweaver-4zu)', () => {
      expect(
        pack.records.find((r) => r.key === 'equipment:warhorse')?.data,
      ).toMatchObject({
        category: 'mount',
        cost: '400 gp',
        speed: '60 ft.',
        carryingCapacity: '540 lb.',
      });
      expect(
        pack.records.find((r) => r.key === 'equipment:galley')?.data,
      ).toMatchObject({
        category: 'vehicle',
        cost: '30,000 gp',
        speed: '4 mph',
      });
      // The Tack/Harness/Drawn Vehicles table is cost/weight gear; the "Saddle"
      // sub-header's bare variants are qualified to "Saddle, <variant>".
      expect(
        pack.records.find((r) => r.key === 'equipment:saddle-military')?.data,
      ).toMatchObject({ category: 'gear', cost: '20 gp', weight: '30 lb.' });
      expect(
        pack.records.find((r) => r.key === 'equipment:carriage')?.data,
      ).toMatchObject({ category: 'gear', cost: '100 gp', weight: '600 lb.' });
    });

    it('imports Equipment Packs as priced bundles with verbatim contents', () => {
      const burglars = pack.records.find(
        (r) => r.key === 'equipment:burglars-pack',
      );
      expect(burglars?.data).toMatchObject({ category: 'pack', cost: '16 gp' });
      const description = (burglars?.data as { description?: unknown })
        .description;
      expect(typeof description).toBe('string');
      expect(description).toContain('Includes a backpack');
      expect(description).toContain('strapped to the side of it');
    });
  });

  // loreweaver-7ok: the alphabetic Spell Descriptions section ends with "Zone
  // of Truth", immediately followed by the gamemastering "Traps" subsection;
  // and the SRD justifies paragraphs, so the "Wish" spell's right-aligned last
  // word "wish" sat just left of the page gutter on p193. Two distinct bugs
  // corrupted the final spell bodies: the spell-descriptions end anchor missed
  // "Traps" (so "Zone of Truth" absorbed the entire Traps→Poisons run), and the
  // column splitter swept "wish" into the right column (so "Word of Recall"
  // gained a stray "wish" mid-sentence). Both are fixed at the importer; these
  // assertions guard the committed pack against either regressing.
  describe('spell-section boundary regression (loreweaver-7ok)', () => {
    function spellDescription(key: string): string {
      const record = pack.records.find((r) => r.key === key);
      expect(record, `expected ${key} in the committed pack`).toBeDefined();
      const data = record?.data as { description?: unknown };
      expect(typeof data.description).toBe('string');
      return data.description as string;
    }

    it('Word of Recall body matches the SRD and carries no neighboring-spell contamination', () => {
      const description = spellDescription('spell:word-of-recall');
      // The true SRD sentence runs straight from "isn't" to "dedicated".
      expect(description).toContain(
        'in an area that isn’t dedicated to your deity, the spell has no effect.',
      );
      expect(description.endsWith('the spell has no effect.')).toBe(true);
      // The pre-fix artifact: the Wish spell's stray "wish" wedged between
      // "isn't" and "dedicated". No standalone "wish" token may remain.
      expect(description).not.toMatch(/\bwish\b/i);
    });

    it('Zone of Truth body ends at the spell boundary and excludes the Traps section', () => {
      const description = spellDescription('spell:zone-of-truth');
      expect(
        description.endsWith('it remains within the boundaries of the truth.'),
      ).toBe(true);
      // The pre-fix artifact: the end anchor missed "Traps", so the body ran on
      // through Traps, Diseases, Madness, Objects, and the Poisons table. None
      // of those landmarks may appear in the spell body.
      for (const leaked of [
        'Traps can be found',
        'Purple Worm Poison',
        'Serpent Venom',
        'Truth Serum',
      ]) {
        expect(description).not.toContain(leaked);
      }
      // A faithful Zone of Truth body is short; the contaminated one was
      // ~38k characters of trailing gamemastering text.
      expect(description.length).toBeLessThan(2000);
    });
  });

  // loreweaver-46m / loreweaver-hvp: the SRD 5.1 PDF contains exactly three
  // reconstructable reference tables — "Typical Difficulty Classes" (p77) and
  // the two trap tables "Trap Save DCs and Attack Bonuses" and "Damage Severity
  // by Level" (p196, from the gamemastering Traps section). The table parser
  // also carries reviewed reconstruction rules for XP-threshold and treasure
  // challenge tables, but those families are absent from the Creative-Commons
  // SRD 5.1 source (non-SRD DM-reference content), so none of them emit a record
  // here — they are exercised only by the importer's fixture-based unit and
  // pipeline tests. This block pins the exact committed table key/name set so
  // coverage cannot silently collapse (a table dropped) or grow (an XP/treasure
  // table appearing would mean a source or parser change that must be reviewed
  // and rebaselined here, alongside EXPECTED_COUNTS_BY_KIND.table).
  describe('table coverage regression baseline (loreweaver-46m, loreweaver-hvp)', () => {
    const tables = pack.records.filter((record) => record.kind === 'table');

    it('contains exactly the reviewed table key set', () => {
      expect(tables.map((record) => record.key).sort()).toEqual([
        'table:damage-severity-by-level',
        'table:difficulty-classes',
        'table:trap-save-dcs-and-attack-bonuses',
      ]);
    });

    it('contains exactly the reviewed table name set', () => {
      expect(tables.map((record) => record.name).sort()).toEqual([
        'Damage Severity by Level',
        'Difficulty Classes',
        'Trap Save DCs and Attack Bonuses',
      ]);
    });

    it('the table count matches the per-kind baseline', () => {
      expect(tables).toHaveLength(EXPECTED_COUNTS_BY_KIND.table);
    });
  });

  describe('audit findings', () => {
    it('reports no suspicious records', () => {
      const audit = auditPack(pack);
      expect(audit.suspiciousRecords).toEqual([]);
    });

    it('partially-populated optional fields match the reviewed baseline', () => {
      const audit = auditPack(pack);
      const compact = audit.missingFieldSummary.map((group) => ({
        kind: group.kind,
        field: group.field,
        missingCount: group.missingCount,
        totalInKind: group.totalInKind,
      }));
      expect(compact).toEqual(EXPECTED_PARTIAL_FIELDS);
    });
  });

  describe('hidden-Unicode hygiene', () => {
    // Read the committed records.json verbatim (not the parsed pack) so the
    // assertion covers the exact bytes that ship — the durable artifact a
    // consumer downloads — rather than a post-load reconstruction.
    const recordsJson = readFileSync(join(PACK_DIR, 'records.json'), 'utf8');

    for (const { name, codePoint } of FORBIDDEN_HYPHEN_CODE_POINTS) {
      it(`contains no ${name} (PDF hyphen-cluster artifact)`, () => {
        const count = [...recordsJson].filter(
          (ch) => ch.codePointAt(0) === codePoint,
        ).length;
        expect(count).toBe(0);
      });
    }
  });

  describe('source-manifest alignment with the vendored SRD artifact', () => {
    const sourceManifest = readSourceManifest();

    it('pack source title and version match the vendored manifest', () => {
      expect(pack.meta.source.sourceTitle).toBe(sourceManifest.sourceTitle);
      expect(pack.meta.source.sourceVersion).toBe(sourceManifest.sourceVersion);
    });

    it('pack license name matches the vendored manifest', () => {
      expect(pack.meta.license.licenseName).toBe(sourceManifest.license.name);
    });

    it('pack records carry the verbatim SRD 5.1 attribution text', () => {
      // The vendored manifest's attribution.text is the verbatim Legal
      // Information preamble from the SRD PDF (loreweaver-bnb). The pack-level
      // license MUST carry that exact string; each record's per-record license
      // copy MUST also carry it. Paraphrasing is a licensing regression.
      expect(pack.meta.license.attributionText).toBe(
        sourceManifest.attribution.text,
      );
      for (const record of pack.records) {
        expect(record.license.attributionText).toBe(
          sourceManifest.attribution.text,
        );
      }
    });

    it('every record provenance references the SRD 5.1 source URL', () => {
      const sourceUrl = pack.meta.source.sourceUrl;
      expect(typeof sourceUrl).toBe('string');
      for (const record of pack.records) {
        expect(record.provenance.sourceRef).toBe(sourceUrl);
      }
    });
  });
});
