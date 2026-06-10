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
  EXPECTED_SRD_5_1_DISEASE_NAMES,
  EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES,
  EXPECTED_SRD_5_1_NPC_NAMES,
  EXPECTED_SRD_5_1_POISON_NAMES,
  EXPECTED_SRD_5_1_RULE_KEYS,
  EXPECTED_SRD_5_1_TABLE_NAMES,
  MIN_EXPECTED_SRD_5_1_CREATURES,
  MIN_EXPECTED_SRD_5_1_MAGIC_ITEMS,
} from '../scripts/importers/dnd5e-srd-5.1/index.js';
import {
  auditPack,
  auditSrdStructure,
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
  // 148 -> 165 (eshyra-0m9.13): the feature-heading boundary fix recovered 17
  // class/subclass features previously swallowed into the preceding feature's
  // body because their heading or grant lead-in went undetected. Each is a real
  // SRD 5.1 feature heading:
  //   curly apostrophe (U+2019) headings — feature:circle-of-the-land:lands-stride
  //   (6th), :natures-ward (10th), :natures-sanctuary (14th);
  //   feature:hunter:hunters-prey (3rd), :superior-hunters-defense (15th);
  //   feature:the-fiend:dark-ones-blessing (1st), :dark-ones-own-luck (6th);
  //   feature:thief:thiefs-reflexes (17th); feature:ranger:lands-stride (8th).
  //   colon heading — feature:life-domain:channel-divinity-preserve-life (2nd).
  //   "Also starting at …" lead-in — feature:life-domain:disciple-of-life (1st);
  //   feature:college-of-lore:cutting-words (3rd, "Also at 3rd level").
  //   "By Nth level …" lead-in — feature:thief:use-magic-device (13th);
  //   feature:rogue:reliable-talent (11th), :slippery-mind (15th).
  //   second-sentence / enumerated grant clause — feature:circle-of-the-land:
  //   circle-spells (3rd, "At 3rd, 5th, 7th, and 9th level"); feature:
  //   draconic-bloodline:draconic-resilience (1st, "At 1st level" after an
  //   intro sentence).
  // 165 -> 167 (eshyra-0m9.14): the progression-table row-stitching fix merges
  // feature cells that wrap across two extracted lines back onto their row
  // before feature detection. Two SRD 5.1 base-class features whose ONLY grant
  // cell wrapped were previously truncated in the table and so swallowed into
  // the preceding feature's body; they are now emitted as their own records:
  //   feature:sorcerer:sorcerous-origin (1st; "Spellcasting, Sorcerous" + wrap
  //   "Origin") and feature:warlock:pact-magic (1st; "Otherworldly Patron, Pact"
  //   + wrap "Magic"). The same fix also corrects two existing records in place
  //   (no count change): feature:fighter:indomitable is renamed from the bogus
  //   feature:fighter:indomitable-three-uses (the wrapped 17th-level repeated-use
  //   cell was mistaken for the canonical heading), and the earliest-grant levels
  //   of feature:druid:ability-score-improvement (12 -> 4) and
  //   feature:bard:magical-secrets (14 -> 10) now come from their wrapped first
  //   grant rows rather than a later un-wrapped row.
  // 167 -> 169 (eshyra-tzl): two subclass features whose grant level is stated
  // by a subclass-entry lead-in the parser did not recognize are now emitted at
  // their 3rd-level grant. Each lead-in occurs exactly once in the SRD 5.1
  // Classes chapter:
  //   feature:college-of-lore:bonus-proficiencies (3rd, "When you join the
  //   College of Lore at 3rd level …") and feature:oath-of-devotion:channel-
  //   divinity (3rd, "When you take this oath at 3rd level …", carrying the
  //   Sacred Weapon and Turn the Unholy options). Emitting the latter is
  //   consistent with the existing Channel Divinity feature precedent
  //   (feature:cleric:channel-divinity, feature:life-domain:channel-divinity-
  //   preserve-life). The subclass blurbs are produced by parseSubclasses and
  //   are unchanged.
  // 169 -> 183 (eshyra-7tc + eshyra-ai9): the Classes slice begins AFTER the
  // "Barbarian" chapter heading (it is the `classes` section-anchor start
  // boundary, excluded from the slice), so parseFeatures opened no class context
  // for the Barbarian body and dropped every Barbarian base-class feature.
  // parseFeatures now opens implicit Barbarian class context at the start of the
  // slice (mirroring parseSubclasses' `currentParent = 'Barbarian'` default),
  // recovering all 14 SRD 5.1 Barbarian base features: feature:barbarian:rage
  // (1), :unarmored-defense (1), :reckless-attack (2), :danger-sense (2),
  // :primal-path (3), :ability-score-improvement (4), :extra-attack (5),
  // :fast-movement (5), :feral-instinct (7), :brutal-critical (9),
  // :relentless-rage (11), :persistent-rage (15), :indomitable-might (18),
  // :primal-champion (20). Unarmored Defense (1st) required a second fix
  // (eshyra-ai9): the Barbarian table is the only SRD 5.1 class table whose
  // Features column is followed by numeric columns (Rages, Rage Damage), so its
  // 1st-level row extracts with those numerics interleaved before the wrapped
  // cell remainder ("1st +2 Rage, 2 +2" | "Unarmored" | "Defense"). Row-stitching
  // now strips the trailing numeric columns before joining the continuation,
  // reuniting the cell as "Rage, Unarmored Defense"; both Rage and Unarmored
  // Defense emit at level 1 with source-bounded descriptions (Rage's body no
  // longer absorbs the Unarmored Defense heading/body).
  feature: 183,
  // 8 sample traps (loreweaver-hvp) + 3 sample diseases + 14 sample poisons
  // (loreweaver-6ra) all emit under the `hazard` kind; SRD 5.1 has no
  // environmental hazards. Traps carry a `trapType` discriminator; diseases and
  // poisons carry `data.category` ('disease' / 'poison').
  hazard: 25,
  // 238 Magic Items A-Z entries plus Orb of Dragonkind from the Artifacts
  // subsection (eshyra-0m9.16).
  'magic-item': 239,
  // Nesting-aware core-rules parse: one rule per heading across the Using
  // Ability Scores, Adventuring, and Combat chapters (loreweaver-yli, 127),
  // plus 34 general Spellcasting rules, five Madness/Objects rules, five
  // Classes-chapter callout rules, the Spellcasting Services prose rule
  // (eshyra-0m9.19), the 18 "Beyond 1st Level" chapter rules — the
  // chapter-intro advancement prose plus the Multiclassing / Alignment /
  // Languages / Inspiration sections (eshyra-0m9.18) — the 10 "Magic
  // Items" chapter-intro usage rules (the intro paragraph, Attunement,
  // Wearing and Wielding Items, Activating an Item, and their leaves;
  // eshyra-0m9.21), and the 6 general gamemastering "Traps" rules (the
  // chapter-intro prose, Traps in Play, Triggering a Trap, Detecting and
  // Disabling a Trap, Trap Effects, Complex Traps; eshyra-0m9.20).
  // Validated exactly against EXPECTED_SRD_5_1_RULE_KEYS.
  rule: 206,
  spell: 319,
  subclass: 12,
  // Difficulty Classes, two trap tables, three Madness tables, two Objects
  // statistics tables (loreweaver-hvp, loreweaver-uuk), the six "Beyond 1st
  // Level" reference tables (Character Advancement, Multiclassing
  // Prerequisites, Multiclassing Proficiencies, Standard Languages, Exotic
  // Languages — eshyra-0m9.23 — and Multiclass Spellcaster: Spell Slots per
  // Spell Level — eshyra-0m9.18), and the five money/downtime tables —
  // Standard Exchange Rates, Trade Goods, Lifestyle Expenses,
  // Food/Drink/Lodging, Services (eshyra-0m9.19).
  table: 19,
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
  'feature:oath-of-devotion:aura-of-devotion',
  'feature:path-of-the-berserker:frenzy',
  'hazard:fire-breathing-statue',
  'hazard:sphere-of-annihilation',
  // Sample diseases + poisons under the `hazard` kind (loreweaver-6ra).
  'hazard:cackle-fever',
  'hazard:assassins-blood',
  'hazard:wyvern-poison',
  'magic-item:adamantine-armor',
  'magic-item:ammunition-1-2-or-3',
  'magic-item:amulet-of-health',
  // Lone "Artifacts"-subsection magic item, parsed from its own slice
  // (eshyra-0m9.16).
  'magic-item:orb-of-dragonkind',
  'rule:cover',
  'rule:death-saving-throws',
  // Spellcasting-rules chapter (loreweaver-3hp): a bare landmark plus one of the
  // cross-slice parent-qualified keys.
  'rule:components',
  'rule:casting-a-spell-range',
  'rule:curing-madness',
  'rule:objects',
  // Equipment-chapter Expenses region: Spellcasting Services prose rule
  // (eshyra-0m9.19).
  'rule:spellcasting-services',
  // Gamemastering Traps section general rules (eshyra-0m9.20).
  'rule:traps',
  'rule:complex-traps',
  'spell:fire-bolt',
  'spell:wish',
  'subclass:champion',
  'table:difficulty-classes',
  'table:object-hit-points',
  'table:short-term-madness',
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
 *   - hazard.{category,poisonType,price,trapType}: the `hazard` kind holds three
 *     gamemastering sub-families (loreweaver-6ra). The 8 traps carry `trapType`;
 *     the 3 diseases + 14 poisons carry `category` ('disease'/'poison'); the 14
 *     poisons additionally carry `poisonType` and `price`. Every hazard record
 *     still carries the required `description`.
 *   - magic-item.attunementRequirement: only the 26 items whose category line
 *     restricts attunement by class, ancestry, alignment, or spellcasting carry
 *     this text; all 239 records still carry the boolean `requiresAttunement`.
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
  // hazard sub-families (loreweaver-6ra): of the 25 hazard records, the 8 traps
  // carry `trapType`; the 3 diseases + 14 poisons carry `category`; the 14
  // poisons additionally carry `poisonType` and `price`.
  { kind: 'hazard', field: 'category', missingCount: 8, totalInKind: 25 },
  { kind: 'hazard', field: 'poisonType', missingCount: 11, totalInKind: 25 },
  { kind: 'hazard', field: 'price', missingCount: 11, totalInKind: 25 },
  { kind: 'hazard', field: 'trapType', missingCount: 17, totalInKind: 25 },
  {
    kind: 'magic-item',
    field: 'attunementRequirement',
    missingCount: 213,
    totalInKind: 239,
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

  describe('subclass-granted feature regression (loreweaver-fak)', () => {
    const features = pack.records.filter((record) => record.kind === 'feature');

    function featureProjection(source: string) {
      return features
        .filter(
          (record) => (record.data as { source?: unknown }).source === source,
        )
        .map((record) => ({
          name: record.name,
          level: (record.data as { level?: unknown }).level,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    it('keeps the exact reviewed feature count for every SRD subclass', () => {
      const counts = new Map<string, number>();
      for (const record of features) {
        const source = (record.data as { source?: unknown }).source;
        if (typeof source === 'string' && source.startsWith('subclass:')) {
          counts.set(source, (counts.get(source) ?? 0) + 1);
        }
      }

      // eshyra-0m9.13 recovered subclass features whose headings/lead-ins the
      // boundary detector previously missed (see the feature-count note above):
      //   circle-of-the-land 2 -> 6 (+Circle Spells, Land's Stride, Nature's
      //     Ward, Nature's Sanctuary) = the full SRD set (Bonus Cantrip, Natural
      //     Recovery, Circle Spells, Land's Stride, Nature's Ward, Nature's
      //     Sanctuary);
      //   college-of-lore 2 -> 4 (+Cutting Words in 0m9.13; +Bonus Proficiencies
      //     in eshyra-tzl via the now-recognized "When you join … at 3rd level"
      //     lead-in) = the full SRD set;
      //   draconic-bloodline 4 -> 5 (+Draconic Resilience);
      //   hunter 2 -> 4 (+Hunter's Prey, Superior Hunter's Defense);
      //   life-domain 4 -> 6 (+Disciple of Life, Channel Divinity: Preserve
      //     Life) = the full SRD set;
      //   the-fiend 2 -> 4 (+Dark One's Blessing, Dark One's Own Luck) = full set;
      //   thief 3 -> 5 (+Use Magic Device, Thief's Reflexes) = full set.
      // oath-of-devotion 3 -> 4 (eshyra-tzl): its 3rd-level "Channel Divinity"
      // feature (Sacred Weapon + Turn the Unholy options) now emits via the
      // now-recognized "When you take this oath at 3rd level" lead-in, consistent
      // with the Cleric/Life Domain Channel Divinity feature precedent. The
      // subclass:oath-of-devotion blurb (parseSubclasses) is unchanged.
      expect(Object.fromEntries([...counts.entries()].sort())).toEqual({
        'subclass:champion': 5,
        'subclass:circle-of-the-land': 6,
        'subclass:college-of-lore': 4,
        'subclass:draconic-bloodline': 5,
        'subclass:hunter': 4,
        'subclass:life-domain': 6,
        'subclass:oath-of-devotion': 4,
        'subclass:path-of-the-berserker': 4,
        'subclass:school-of-evocation': 5,
        'subclass:the-fiend': 4,
        'subclass:thief': 5,
        'subclass:way-of-the-open-hand': 4,
      });
    });

    it('attributes Oath of Devotion features to the subclass at correct levels', () => {
      // Channel Divinity (3rd) recovered in eshyra-tzl; projection is sorted by
      // name, so it sits first.
      expect(featureProjection('subclass:oath-of-devotion')).toEqual([
        { name: 'Aura of Devotion', level: 7 },
        { name: 'Channel Divinity', level: 3 },
        { name: 'Holy Nimbus', level: 20 },
        { name: 'Purity of Spirit', level: 15 },
      ]);

      const oathFeatureNames = new Set([
        'Aura of Devotion',
        'Channel Divinity',
        'Holy Nimbus',
        'Purity of Spirit',
      ]);
      expect(
        features.filter(
          (record) =>
            (record.data as { source?: unknown }).source === 'class:paladin' &&
            oathFeatureNames.has(record.name),
        ),
      ).toEqual([]);
    });

    it('emits every Path of the Berserker feature at its grant level', () => {
      expect(featureProjection('subclass:path-of-the-berserker')).toEqual([
        { name: 'Frenzy', level: 3 },
        { name: 'Intimidating Presence', level: 10 },
        { name: 'Mindless Rage', level: 6 },
        { name: 'Retaliation', level: 14 },
      ]);
    });

    it('emits the complete SRD Barbarian base-class feature set at their grant levels (eshyra-7tc, eshyra-ai9)', () => {
      // The Classes slice begins after the sliced-away "Barbarian" chapter
      // heading; parseFeatures' implicit Barbarian class context recovers the
      // base features (previously dropped entirely). Unarmored Defense (1st) is
      // recovered by the eshyra-ai9 row-stitching fix that strips the Barbarian
      // table's trailing Rages/Rage Damage numeric columns before reuniting the
      // wrapped feature cell, so it is its own record rather than swallowed into
      // Rage. This is the full 14-feature SRD 5.1 Barbarian base set.
      expect(featureProjection('class:barbarian')).toEqual([
        { name: 'Ability Score Improvement', level: 4 },
        { name: 'Brutal Critical', level: 9 },
        { name: 'Danger Sense', level: 2 },
        { name: 'Extra Attack', level: 5 },
        { name: 'Fast Movement', level: 5 },
        { name: 'Feral Instinct', level: 7 },
        { name: 'Indomitable Might', level: 18 },
        { name: 'Persistent Rage', level: 15 },
        { name: 'Primal Champion', level: 20 },
        { name: 'Primal Path', level: 3 },
        { name: 'Rage', level: 1 },
        { name: 'Reckless Attack', level: 2 },
        { name: 'Relentless Rage', level: 11 },
        { name: 'Unarmored Defense', level: 1 },
      ]);
    });

    it('keeps the Oath of Devotion description beyond its spells table', () => {
      const oath = pack.records.find(
        (record) => record.key === 'subclass:oath-of-devotion',
      );
      const description = (oath?.data as { description?: unknown }).description;
      expect(typeof description).toBe('string');
      expect(description).toContain('Oath of Devotion Spells');
      expect(description).toContain('Aura of Devotion');
      expect(description).toContain('Holy Nimbus');
    });
  });

  // eshyra-0m9.13 feature-boundary regression on the committed pack. The
  // extraction-layer band fix removed the class proficiency setup block from
  // every class first feature, and the parser-layer heading/lead-in fix split
  // out subclass/class features that the previous detector swallowed into the
  // preceding feature's body. These assertions pin both ends against the
  // committed pack so the corruption cannot return.
  describe('feature boundary regression (eshyra-0m9.13)', () => {
    const features = pack.records.filter((record) => record.kind === 'feature');
    const byKey = new Map(features.map((record) => [record.key, record]));
    const descOf = (key: string): string => {
      const record = byKey.get(key);
      expect(record, `expected ${key} in the committed pack`).toBeDefined();
      const description = (record?.data as { description?: unknown })
        .description;
      expect(typeof description).toBe('string');
      return description as string;
    };
    const levelOf = (key: string): unknown =>
      (byKey.get(key)?.data as { level?: unknown }).level;

    const SETUP_LABEL = /\b(?:Armor|Weapons|Tools|Saving Throws|Skills):/;

    // The 8 class first features that previously absorbed the proficiency setup
    // block via the two-column-table reading-order bug.
    const FIRST_FEATURE_KEYS: readonly string[] = [
      'feature:bard:spellcasting',
      'feature:cleric:spellcasting',
      'feature:druid:druidic',
      'feature:monk:martial-arts',
      'feature:paladin:divine-sense',
      'feature:ranger:favored-enemy',
      'feature:warlock:otherworldly-patron',
      'feature:wizard:cantrips',
    ];

    it('no class first feature carries the proficiency setup block', () => {
      for (const key of FIRST_FEATURE_KEYS) {
        expect(
          SETUP_LABEL.test(descOf(key)),
          `${key} carries a setup label`,
        ).toBe(false);
      }
    });

    it('the structure audit reports zero feature setup-label bleed', () => {
      const bleed = auditSrdStructure(pack).filter(
        (finding) => finding.category === 'feature-setup-label-bleed',
      );
      expect(bleed).toEqual([]);
    });

    it('completes the Bard Spellcasting body past its displaced continuation', () => {
      const body = descOf('feature:bard:spellcasting');
      // The intro continuation ("Your spells are part …") and the subsequent
      // spellcasting subsections were displaced past the table pre-fix.
      expect(body).toContain('Your spells are part of your vast repertoire');
      expect(body).toContain('Spell Slots');
    });

    // Previously-swallowed headings now stand as their own records at their SRD
    // grant levels (curly apostrophe, colon, and "Also"/"By"/enumerated lead-ins).
    const RECOVERED: ReadonlyArray<readonly [key: string, level: number]> = [
      ['feature:life-domain:disciple-of-life', 1],
      ['feature:life-domain:channel-divinity-preserve-life', 2],
      ['feature:hunter:hunters-prey', 3],
      ['feature:hunter:superior-hunters-defense', 15],
      ['feature:circle-of-the-land:circle-spells', 3],
      ['feature:circle-of-the-land:lands-stride', 6],
      ['feature:circle-of-the-land:natures-ward', 10],
      ['feature:circle-of-the-land:natures-sanctuary', 14],
      ['feature:thief:use-magic-device', 13],
      ['feature:thief:thiefs-reflexes', 17],
      ['feature:rogue:reliable-talent', 11],
      ['feature:rogue:slippery-mind', 15],
      ['feature:ranger:lands-stride', 8],
      ['feature:college-of-lore:cutting-words', 3],
      ['feature:draconic-bloodline:draconic-resilience', 1],
      ['feature:the-fiend:dark-ones-blessing', 1],
      ['feature:the-fiend:dark-ones-own-luck', 6],
    ];

    it('emits each recovered swallowed feature at its SRD grant level', () => {
      for (const [key, level] of RECOVERED) {
        expect(byKey.has(key), `expected ${key} in the committed pack`).toBe(
          true,
        );
        expect(levelOf(key), `${key} grant level`).toBe(level);
      }
    });

    it('the previously-swallowing feature no longer absorbs the recovered headings', () => {
      expect(descOf('feature:life-domain:bonus-proficiency')).not.toMatch(
        /Disciple of Life|Preserve Life/,
      );
      expect(descOf('feature:hunter:multiattack')).not.toMatch(
        /Superior Hunter’s Defense/,
      );
      expect(descOf('feature:circle-of-the-land:natural-recovery')).not.toMatch(
        /Land’s Stride|Nature’s Ward|Nature’s Sanctuary/,
      );
      expect(descOf('feature:thief:supreme-sneak')).not.toMatch(
        /Use Magic Device|Thief’s Reflexes/,
      );
    });
  });

  // eshyra-0m9.14 progression-table row-stitching regression on the committed
  // pack. SRD class tables wrap a feature cell across two extracted lines when
  // the text exceeds its column width; stitching the continuation back onto its
  // row before feature detection fixes two failure modes: a repeated feature
  // losing its earliest grant level / canonical name to a later un-wrapped row,
  // and a wrapped first/only-grant cell being truncated so the feature gets
  // swallowed into the preceding feature's body. These assertions pin the
  // committed pack so the corruption cannot return.
  describe('progression-table row-stitching regression (eshyra-0m9.14)', () => {
    const features = pack.records.filter((record) => record.kind === 'feature');
    const byKey = new Map(features.map((record) => [record.key, record]));
    const levelOf = (key: string): unknown =>
      (byKey.get(key)?.data as { level?: unknown }).level;
    const descOf = (key: string): string =>
      (byKey.get(key)?.data as { description?: unknown }).description as string;

    it('emits Fighter Indomitable under its canonical heading at its earliest grant', () => {
      expect(byKey.has('feature:fighter:indomitable')).toBe(true);
      expect(byKey.get('feature:fighter:indomitable')?.name).toBe(
        'Indomitable',
      );
      expect(levelOf('feature:fighter:indomitable')).toBe(9);
      // The bogus key built from the wrapped 17th-level "(three uses)" cell is gone.
      expect(byKey.has('feature:fighter:indomitable-three-uses')).toBe(false);
      // No feature name carries a repeated-use progression parenthetical.
      expect(
        features.some((record) =>
          /\((?:one|two|three) uses?\)/.test(record.name),
        ),
      ).toBe(false);
      // The usage progression stays in the body.
      expect(descOf('feature:fighter:indomitable')).toMatch(
        /twice between long rests/,
      );
    });

    it('takes the earliest (wrapped) grant level for repeated class features', () => {
      // Druid/Bard ASI/Magical Secrets first grants wrap across two lines; the
      // un-wrapped later rows must no longer win the level.
      expect(levelOf('feature:druid:ability-score-improvement')).toBe(4);
      expect(levelOf('feature:bard:magical-secrets')).toBe(10);
    });

    it('emits the base-class features whose only grant cell wrapped', () => {
      // Previously truncated to "Sorcerous"/"Pact" and swallowed into the
      // preceding feature; stitching completes the cell so they stand alone.
      expect(byKey.has('feature:sorcerer:sorcerous-origin')).toBe(true);
      expect(levelOf('feature:sorcerer:sorcerous-origin')).toBe(1);
      expect(byKey.has('feature:warlock:pact-magic')).toBe(true);
      expect(levelOf('feature:warlock:pact-magic')).toBe(1);
    });

    it('the preceding feature no longer absorbs the recovered base-class headings', () => {
      expect(descOf('feature:sorcerer:cantrips')).not.toMatch(
        /Sorcerous Origin/,
      );
      expect(descOf('feature:warlock:otherworldly-patron')).not.toMatch(
        /Pact Magic/,
      );
    });
  });

  // eshyra-tzl: subclass features whose grant level is stated by a subclass-
  // entry lead-in the parser previously did not recognize ("When you join …",
  // "When you take this oath …") are now emitted at their 3rd-level grant, and
  // the structure audit no longer false-positives on the "Spells Known of 1st
  // Level and Higher" spellcasting sub-heading.
  describe('subclass-entry lead-in recovery + audit refinement (eshyra-tzl)', () => {
    const features = pack.records.filter((record) => record.kind === 'feature');
    const byKey = new Map(features.map((record) => [record.key, record]));
    const levelOf = (key: string): unknown =>
      (byKey.get(key)?.data as { level?: unknown }).level;
    const descOf = (key: string): string =>
      (byKey.get(key)?.data as { description?: unknown }).description as string;

    it('emits College of Lore Bonus Proficiencies at its 3rd-level entry grant', () => {
      expect(byKey.has('feature:college-of-lore:bonus-proficiencies')).toBe(
        true,
      );
      expect(levelOf('feature:college-of-lore:bonus-proficiencies')).toBe(3);
    });

    it('emits Oath of Devotion Channel Divinity at level 3 with both options in the body', () => {
      expect(byKey.has('feature:oath-of-devotion:channel-divinity')).toBe(true);
      expect(levelOf('feature:oath-of-devotion:channel-divinity')).toBe(3);
      const body = descOf('feature:oath-of-devotion:channel-divinity');
      expect(body).toMatch(/Sacred Weapon/);
      expect(body).toMatch(/Turn the Unholy/);
    });

    it('the structure audit no longer flags the Pact Magic spellcasting sub-heading', () => {
      const finding = auditSrdStructure(pack).find(
        (f) =>
          f.category === 'swallowed-feature-heading' &&
          f.key === 'feature:warlock:pact-magic',
      );
      expect(finding).toBeUndefined();
    });
  });

  // eshyra-0m9.15: ancestry trait line-wrapping and table bleed. The SRD PDF
  // wraps the Languages line so "Common and <Language>. <prose>" lands on its
  // own line, and interleaves the Dragonborn Draconic Ancestry breath-weapon
  // table between the Speed and Draconic Ancestry traits. Pre-fix this promoted
  // wrapped continuations to bogus traits ("Common and Dwarvish", "Ancestry
  // table") and bled the table into the Speed trait body. These assertions pin
  // the committed pack so the corruption cannot return.
  describe('ancestry trait wrapping + table bleed regression (eshyra-0m9.15)', () => {
    const ancestries = pack.records.filter(
      (record) => record.kind === 'ancestry',
    );
    const traitsOf = (
      record: (typeof ancestries)[number],
    ): ReadonlyArray<{ name: string; text: string }> =>
      ((record.data as { traits?: unknown }).traits ?? []) as ReadonlyArray<{
        name: string;
        text: string;
      }>;

    it('the structure audit reports zero ancestry-bogus-trait findings', () => {
      const bogus = auditSrdStructure(pack).filter(
        (finding) => finding.category === 'ancestry-bogus-trait',
      );
      expect(bogus).toEqual([]);
    });

    it('no ancestry trait name is a wrapped Languages/table line fragment', () => {
      for (const record of ancestries) {
        for (const trait of traitsOf(record)) {
          expect(
            /\b(?:and|or|the|of|table)\b/.test(trait.name),
            `${record.key} trait "${trait.name}" is a wrapped fragment`,
          ).toBe(false);
        }
      }
    });

    it('every Languages trait body is complete (carries its languages + prose)', () => {
      for (const record of ancestries) {
        const languages = traitsOf(record).filter(
          (t) => t.name === 'Languages',
        );
        // Each ancestry has exactly one Languages trait, not a truncated stub
        // plus a bogus "Common and …" continuation.
        expect(languages).toHaveLength(1);
        expect(languages[0].text).toMatch(/You can speak, read, and write \w/);
        // A truncated body ended exactly at "…and write"; a complete one names
        // Common and ends with sentence punctuation.
        expect(languages[0].text).toMatch(/Common/);
        expect(languages[0].text.trim()).toMatch(/[.!?]$/);
      }
    });

    it('the Dragonborn Speed trait is free of the breath-weapon table', () => {
      const dragonborn = ancestries.find((r) => r.name === 'Dragonborn');
      const speed = traitsOf(dragonborn as (typeof ancestries)[number]).find(
        (t) => t.name === 'Speed',
      );
      expect(speed?.text).toBe('Your base walking speed is 30 feet.');
      expect(speed?.text).not.toMatch(/save\)/);
      expect(speed?.text).not.toMatch(/Damage Type/);
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

    function magicItemDescription(key: string): string {
      const data = magicItemData(key);
      expect(typeof data.description).toBe('string');
      return data.description as string;
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

    it('imports Orb of Dragonkind from the Artifacts subsection (eshyra-0m9.16)', () => {
      // The lone artifact magic item (SRD 5.1 p252-253) sits after the "Sentient
      // Magic Items" guidance that ends the A-Z slice, so it is parsed from its
      // own "Artifacts" slice and concatenated. Its category line is "Wondrous
      // item, artifact (requires attunement)".
      const orb = magicItemData('magic-item:orb-of-dragonkind');
      expect(orb).toMatchObject({
        itemType: 'Wondrous item',
        rarity: 'artifact',
        requiresAttunement: true,
      });
      const description = magicItemDescription('magic-item:orb-of-dragonkind');
      expect(description).toMatch(/^Ages past, elves and humans waged/);
      // Whole body captured, including the trailing sub-sections.
      expect(description).toContain('Call Dragons.');
      expect(description).toContain('sufficient to destroy an orb, however.');
      // The Monsters chapter that bounds the slice must not bleed in.
      expect(description).not.toContain('stat block');
      const orbRecord = magicItems.find(
        (record) => record.key === 'magic-item:orb-of-dragonkind',
      );
      expect(orbRecord?.source).toBe('SRD 5.1 p. 252');
    });

    it('keeps page 226 magic-item bodies in source column order', () => {
      expect(magicItemDescription('magic-item:holy-avenger')).toContain(
        'the radius of the aura increases to 30 feet',
      );

      const blasting = magicItemDescription('magic-item:horn-of-blasting');
      expect(blasting).toMatch(/^You can use an action to speak/);
      expect(blasting).toContain('causing the horn to explode');
      expect(blasting).not.toContain('horseshoes');

      expect(magicItemData('magic-item:horn-of-valhalla')).toMatchObject({
        rarity:
          'rare (silver or brass), very rare (bronze), or legendary (iron)',
      });
      const valhalla = magicItemDescription('magic-item:horn-of-valhalla');
      expect(valhalla).toContain('d100 Horn Berserkers Requirement');
      expect(valhalla).toContain('Proficiency with all martial weapons');
      expect(valhalla).not.toContain('Immovable Rod');

      const zephyr = magicItemDescription('magic-item:horseshoes-of-a-zephyr');
      expect(zephyr).toMatch(/^These iron horseshoes come in a set of four/);
      expect(zephyr).toContain('floating 4 inches above the ground');
      expect(zephyr).not.toContain('radius of the aura');

      const speed = magicItemDescription('magic-item:horseshoes-of-speed');
      expect(speed).toContain(
        'increase the creature’s walking speed by 30 feet',
      );
      expect(speed).not.toContain('thunder damage');

      const rod = magicItemDescription('magic-item:immovable-rod');
      expect(rod).toContain('magically fixed in place');
      expect(rod).toContain('moving the fixed rod up to 10 feet on a success');
      expect(rod).not.toContain('are known to exist');

      const fortress = magicItemDescription('magic-item:instant-fortress');
      expect(fortress).toMatch(
        /^You can use an action to place this 1-inch metal cube/,
      );
      expect(fortress).not.toContain('d100 Horn Berserkers');
      expect(fortress).not.toContain('Proficiency with all');
    });

    it('keeps interleaved Ring page bodies assigned to the matching Ring records', () => {
      const featherFalling = magicItemDescription(
        'magic-item:ring-of-feather-falling',
      );
      expect(featherFalling).toContain('When you fall while wearing this ring');
      expect(featherFalling).not.toContain('resistance to acid damage');
      expect(featherFalling).not.toContain('move through solid earth or rock');

      const evasion = magicItemDescription('magic-item:ring-of-evasion');
      expect(evasion).toContain('When you fail a Dexterity saving throw');
      expect(evasion).toContain('succeed on that saving throw instead');
      expect(evasion).not.toContain('telepathic communication');
      expect(evasion).not.toContain('jump spell');

      const freeAction = magicItemDescription('magic-item:ring-of-free-action');
      expect(freeAction).toContain('difficult terrain does');
      expect(freeAction).toContain('extra movement');
      expect(freeAction).not.toContain('stone shape');
      expect(freeAction).not.toContain('Ring of Fire Elemental Command');

      const invisibility = magicItemDescription(
        'magic-item:ring-of-invisibility',
      );
      expect(invisibility).toContain('you can turn invisible as an action');
      expect(invisibility).not.toContain('resistance to fire damage');
      expect(invisibility).not.toContain('understand Ignan');
      expect(invisibility).not.toContain('immune to fire damage');

      const jumping = magicItemDescription('magic-item:ring-of-jumping');
      expect(jumping).toContain('cast the jump spell');
      expect(jumping).not.toContain('burning hands');
      expect(jumping).not.toContain('Ring of Water Elemental Command');

      const mindShielding = magicItemDescription(
        'magic-item:ring-of-mind-shielding',
      );
      expect(mindShielding).toContain(
        'immune to magic that allows other creatures',
      );
      expect(mindShielding).not.toContain('water elemental');
      expect(mindShielding).not.toContain('breathe underwater');
      expect(mindShielding).not.toContain('create or destroy water');
    });

    it('keeps the Vicious Weapon and Vorpal Sword boundary separate', () => {
      const vicious = magicItemDescription('magic-item:vicious-weapon');
      expect(vicious).toContain('critical hit deals an extra 2d6 damage');
      expect(vicious).not.toContain('Vorpal Sword');
      expect(vicious).not.toContain('You gain a +3 bonus');

      const vorpal = magicItemDescription('magic-item:vorpal-sword');
      expect(vorpal).toContain('You gain a +3 bonus');
      expect(vorpal).toContain('cut off one of the creature');
      expect(vorpal).not.toContain('Wand of Binding');
    });

    // loreweaver-ecr: SRD 5.1 p217-p218 justify the right column and push up to
    // three line-final words ("wish", "spell", "remove curse") flush to the page
    // edge, opening an x-gap wider than the real page gutter. The column splitter
    // once isolated those stragglers as a phantom column and collapsed the two
    // real columns into one y-interleaved flow, splicing the embedded "Avatar of
    // Death" stat block (left column, part of the Deck of Many Things entry)
    // line-by-line into the Defender and Demon Armor item bodies. These
    // assertions guard the de-interleaved column extraction so neighboring
    // stat-block / card text cannot bleed back into the swords-and-armor items.
    it('does not bleed the Avatar of Death stat block into Defender or Demon Armor', () => {
      const defender = magicItemDescription('magic-item:defender');
      expect(defender).toContain(
        'You gain a +3 bonus to attack and damage rolls',
      );
      expect(defender).toContain('transfer some or all of the sword');
      expect(defender).not.toContain('Avatar of Death');
      expect(defender).not.toContain('Senses darkvision 60 ft., truesight');
      expect(defender).not.toContain(
        'Languages all languages known to its summoner',
      );
      expect(defender).not.toContain('Incorporeal Movement');
      expect(defender).not.toContain('Turning Immunity');
      expect(defender).not.toContain('Reaping Scythe');

      const demonArmor = magicItemDescription('magic-item:demon-armor');
      expect(demonArmor).toContain('While wearing this armor, you gain a +1');
      expect(demonArmor).toContain('understand and speak Abyssal');
      // The straggler "remove curse" must read in its own item's prose.
      expect(demonArmor).toContain(
        'targeted by the remove curse spell or similar magic',
      );
      expect(demonArmor).not.toContain('Avatar of Death');
      expect(demonArmor).not.toContain('Reaping Scythe');
      expect(demonArmor).not.toContain(
        'Star. Increase one of your ability scores',
      );
      expect(demonArmor).not.toContain('Throne. You gain proficiency');
      expect(demonArmor).not.toContain('Sun. You gain 50,000 XP');
    });

    // loreweaver-ecr: "Sword of Sharpness" wraps its category line mid-rarity
    // ("Weapon (any sword that deals slashing damage), very" / "rare (requires
    // attunement)"), so the line ends with the bare word "very" and the old
    // boundary detector missed the item entirely — its heading and body were
    // swallowed into the preceding "Sword of Life Stealing" record.
    it('splits Sword of Sharpness out of Sword of Life Stealing', () => {
      const lifeStealing = magicItemDescription(
        'magic-item:sword-of-life-stealing',
      );
      expect(lifeStealing).toContain('extra 3d6 necrotic damage');
      expect(lifeStealing).toContain(
        'temporary hit points equal to the extra damage',
      );
      expect(lifeStealing).not.toContain('Sword of Sharpness');
      expect(lifeStealing).not.toContain('slashing damage');
      expect(lifeStealing).not.toContain('lop off');

      expect(magicItemData('magic-item:sword-of-sharpness')).toMatchObject({
        itemType: 'Weapon (any sword that deals slashing damage)',
        rarity: 'very rare',
        requiresAttunement: true,
      });
      const sharpness = magicItemDescription('magic-item:sword-of-sharpness');
      expect(sharpness).toContain('maximize your weapon damage dice against');
      expect(sharpness).toContain('extra 4d6 slashing damage');
      expect(sharpness).toContain('lop off one of the target');
      expect(sharpness).not.toContain('Sword of Wounding');
      expect(sharpness).not.toContain('necrotic damage');
      expect(sharpness).not.toMatch(/^Weapon \(/);
    });

    // The interleaving fix must not strip the Avatar of Death stat block and
    // card descriptions from the Deck of Many Things entry, where they
    // legitimately belong in the source.
    it('keeps the Avatar of Death stat block and card text in the Deck of Many Things entry', () => {
      const deck = magicItemDescription('magic-item:deck-of-many-things');
      expect(deck).toContain('this deck contains a');
      expect(deck).toContain('Avatar of Death');
      expect(deck).toContain('Reaping Scythe');
      expect(deck).toContain('The Void');
    });

    it('parses wrapped category attunement parentheticals into item metadata', () => {
      const cases = [
        {
          key: 'magic-item:ring-of-shooting-stars',
          itemType: 'Ring',
          rarity: 'very rare',
          attunementRequirement: 'outdoors at night',
          bodyStart: 'While wearing this ring in dim light or darkness',
        },
        {
          key: 'magic-item:holy-avenger',
          itemType: 'Weapon (any sword)',
          rarity: 'legendary',
          attunementRequirement: 'by a paladin',
          bodyStart: 'You gain a +3 bonus',
        },
        {
          key: 'magic-item:pearl-of-power',
          itemType: 'Wondrous item',
          rarity: 'uncommon',
          attunementRequirement: 'by a spellcaster',
          bodyStart: 'While this pearl is on your person',
        },
        {
          key: 'magic-item:talisman-of-pure-good',
          itemType: 'Wondrous item',
          rarity: 'legendary',
          attunementRequirement: 'by a creature of good alignment',
          bodyStart: 'This talisman is a mighty symbol of goodness',
        },
        {
          key: 'magic-item:talisman-of-ultimate-evil',
          itemType: 'Wondrous item',
          rarity: 'legendary',
          attunementRequirement: 'by a creature of evil alignment',
          bodyStart: 'This item symbolizes unrepentant evil',
        },
        {
          key: 'magic-item:wand-of-polymorph',
          itemType: 'Wand',
          rarity: 'very rare',
          attunementRequirement: 'by a spellcaster',
          bodyStart: 'This wand has 7 charges',
        },
        {
          key: 'magic-item:wand-of-web',
          itemType: 'Wand',
          rarity: 'uncommon',
          attunementRequirement: 'by a spellcaster',
          bodyStart: 'This wand has 7 charges',
        },
      ];

      for (const expected of cases) {
        const data = magicItemData(expected.key);
        expect(data).toMatchObject({
          itemType: expected.itemType,
          rarity: expected.rarity,
          requiresAttunement: true,
          attunementRequirement: expected.attunementRequirement,
        });
        const description = magicItemDescription(expected.key);
        expect(description).toContain(expected.bodyStart);
        expect(description).not.toContain('requires attunement');
        expect(description).not.toMatch(/^\w+\)/);
      }
    });

    it('keeps Ring of Three Wishes spell wording intact', () => {
      const description = magicItemDescription(
        'magic-item:ring-of-three-wishes',
      );
      expect(description).toContain('cast the wish spell from it');
      expect(description).not.toContain('cast the wish it');
    });
  });

  // loreweaver-yli: the nesting-aware rule parser keys body boundaries off
  // per-line font tiers. The SRD's gray callout boxes render their heading at a
  // sub-leaf size (h≈10.8), so the parser must recognize that tier — otherwise
  // a box heading reads as body and its whole rule is swallowed into the
  // preceding record. These assertions pin the box rules and the boundaries
  // around them so the corruption cannot return (the Hiding rule, with its
  // inline Passive Perception / What Can You See? lead-ins, was once buried in
  // the Dexterity "Initiative" sidebar).
  describe('rule body-boundary regression (loreweaver-yli)', () => {
    const rules = pack.records.filter((record) => record.kind === 'rule');

    function ruleText(key: string): string {
      const record = rules.find((r) => r.key === key);
      expect(record, `expected ${key} in the committed pack`).toBeDefined();
      const data = record?.data as { text?: unknown };
      expect(typeof data.text).toBe('string');
      return data.text as string;
    }

    it('committed pack rule keys match the checked-in baseline exactly', () => {
      expect(rules.map((record) => record.key).sort()).toEqual(
        [...EXPECTED_SRD_5_1_RULE_KEYS].sort(),
      );
    });

    it('EXPECTED_SRD_5_1_RULE_KEYS has no duplicates', () => {
      expect(new Set(EXPECTED_SRD_5_1_RULE_KEYS).size).toBe(
        EXPECTED_SRD_5_1_RULE_KEYS.length,
      );
    });

    it('keeps the Madness rules distinct and excludes their effect tables', () => {
      const madness = ruleText('rule:madness');
      expect(madness).toContain('campaign has a strong horror theme');
      expect(madness).not.toContain('Going Mad');

      const goingMad = ruleText('rule:going-mad');
      expect(goingMad).toContain('Wisdom or Charisma saving throw');
      expect(goingMad).not.toContain('Madness Effects');

      const effects = ruleText('rule:madness-effects');
      expect(effects).toContain('Short-Term Madness');
      expect(effects).toContain('Long-Term Madness');
      expect(effects).toContain('Indefinite Madness');
      expect(effects).not.toContain('d100');

      const curing = ruleText('rule:curing-madness');
      expect(curing).toContain('greater restoration');
      expect(curing).not.toContain('Statistics for Objects');
    });

    it('keeps Objects prose complete and excludes table rows and Poisons', () => {
      const objects = ruleText('rule:objects');
      for (const landmark of [
        'Statistics for Objects',
        'Armor Class.',
        'Hit Points.',
        'Huge and Gargantuan Objects.',
        'Objects and Damage Types.',
        'Damage Threshold.',
      ]) {
        expect(objects).toContain(landmark);
      }
      for (const excluded of [
        'Cloth, paper, rope 11',
        'Tiny (bottle, lock)',
        'Fragile Resilient',
        'Poisons',
      ]) {
        expect(objects).not.toContain(excluded);
      }
    });

    it('captures the Hiding callout box as its own rule', () => {
      const hiding = ruleText('rule:hiding');
      expect(hiding).toContain(
        'When you try to hide, make a Dexterity (Stealth)',
      );
      // The box's inline bold lead-ins belong to the Hiding rule, not a neighbor.
      expect(hiding).toContain('Passive Perception');
      expect(hiding).toContain('What Can You See?');
    });

    it('does not bury the Hiding / Perception block under Dexterity Initiative', () => {
      const initiative = ruleText('rule:dexterity-initiative');
      // The Dexterity-section Initiative sidebar is only its own two sentences.
      expect(initiative).toContain('you roll initiative');
      expect(initiative).toContain('creatures’ turns in combat');
      expect(initiative).not.toContain('Dexterity (Stealth)');
      expect(initiative).not.toContain('Passive Perception');
      expect(initiative).not.toContain('What Can You See?');
    });

    it('captures the other sub-leaf callout boxes as their own rules', () => {
      expect(ruleText('rule:combat-step-by-step')).toContain(
        'Determine surprise',
      );
      expect(ruleText('rule:interacting-with-objects-around-you')).toContain(
        'draw or sheathe a sword',
      );
      expect(ruleText('rule:contests-in-combat')).toContain(
        'grappling and shoving a creature',
      );
    });

    it('keeps cross-chapter same-named rules on distinct parent-qualified keys', () => {
      // "Hit Points" appears under both Constitution and Damage and Healing.
      expect(ruleText('rule:constitution-hit-points')).toContain(
        'Constitution modifier contributes',
      );
      expect(ruleText('rule:damage-and-healing-hit-points')).toContain(
        'represent a combination of physical and mental durability',
      );
    });
  });

  // loreweaver-3hp: an inline italic run (a spell name mid-paragraph) starts at
  // a high x because the words before it on the same line consumed the column
  // width. On a sparse, effectively single-column page that opened a spurious
  // START-x gap, so `partitionItemsByColumn` cut the run into a phantom right
  // column emitted AFTER the rest of the paragraph — scrambling the source word
  // order. The extractor now rejects a tiny-island cut that slices a contiguous
  // line of text. These assertions pin the corrected reading order.
  describe('inline-flow column-split regression (loreweaver-3hp)', () => {
    function bodyOf(key: string): string {
      const record = pack.records.find((r) => r.key === key);
      expect(record, `expected ${key} in the committed pack`).toBeDefined();
      const data = record?.data as { text?: unknown; description?: unknown };
      const body = data.text ?? data.description;
      expect(typeof body).toBe('string');
      return body as string;
    }

    it('reconstructs the Combining Magical Effects bless example in source order', () => {
      const text = bodyOf('rule:combining-magical-effects');
      expect(text).toContain('if two clerics cast bless on the same target');
      // The pre-fix corruption split "bless on the same" to the end of the body
      // ("…cast target, … two bonus dice. bless on the same").
      expect(text).not.toMatch(/clerics cast target,/);
      expect(text).not.toMatch(/bless on the same\s*$/);
    });

    // The Wizard "Your Spellbook" prose ("You can copy a spell from your own…",
    // "Your spellbook is a unique…") lived on the same sparse page family and was
    // a second real-pack witness for this extractor fix when it bled into the
    // School of Evocation subclass/Overchannel records. loreweaver-6fw bounds the
    // callout out of those records, and loreweaver-0m9.5.23 now retains it in the
    // standalone `rule:wizard-your-spellbook` record. The extractor's source-order
    // behavior on that page shape remains covered directly by the synthetic-probe
    // test in extract.test.ts ("does not split a contiguous inline run into a
    // phantom column on a sparse page"); the bless example above remains the
    // real-pack guard. See the callout-box bleed regression block below.
  });

  // loreweaver-6fw: the Classes chapter prints five gray callout boxes (generic
  // class/DM procedure sidebars) at a distinct font-height tier (h≈10.8 heading,
  // h≈8.9 body), each AFTER a subclass's last feature and BEFORE the next base
  // class. Because their titles start with prose words ("Your Spellbook", "Your
  // Pact Boon", "Breaking Your Oath") or otherwise carry no feature/table anchor,
  // the parser used to run the preceding subclass description and last feature
  // body straight through them, absorbing the whole sidebar. The feature/subclass
  // parsers now bound a body at the callout-box height tier, dropping the sidebar
  // prose (DM/class procedure, not subclass or feature content). These assertions
  // pin every affected record so the bleed cannot return.
  describe('class callout-box bleed regression (loreweaver-6fw)', () => {
    function bodyOf(key: string): string {
      const record = pack.records.find((r) => r.key === key);
      expect(record, `expected ${key} in the committed pack`).toBeDefined();
      const data = record?.data as { text?: unknown; description?: unknown };
      const body = data.text ?? data.description;
      expect(typeof body).toBe('string');
      return body as string;
    }

    const expectedCalloutRules: ReadonlyArray<{
      readonly key: string;
      readonly locator: string;
      readonly bodyPhrase: string;
      readonly excludedPhrase?: string;
    }> = [
      {
        key: 'rule:druid-druids-and-the-gods',
        locator: 'p. 23',
        bodyPhrase: 'nature deities',
        excludedPhrase: 'As a fighter, you gain the following class features',
      },
      {
        key: 'rule:druid-sacred-plants-and-wood',
        locator: 'p. 22',
        bodyPhrase: 'A druid holds certain plants to be sacred',
        excludedPhrase: 'nature deities',
      },
      {
        key: 'rule:paladin-breaking-your-oath',
        locator: 'p. 33',
        bodyPhrase: 'impenitent paladin',
        excludedPhrase: 'As a ranger, you gain the following class features',
      },
      {
        key: 'rule:warlock-your-pact-boon',
        locator: 'p. 51',
        bodyPhrase: 'Pact of the Chain',
        excludedPhrase: 'As a wizard, you gain the following class features',
      },
      {
        key: 'rule:wizard-your-spellbook',
        locator: 'p. 54',
        bodyPhrase: 'the process takes 2 hours and costs 50 gp',
      },
    ];

    for (const expected of expectedCalloutRules) {
      it(`emits ${expected.key} as an independent rule`, () => {
        const record = pack.records.find(
          (candidate) => candidate.key === expected.key,
        );
        expect(
          record,
          `expected ${expected.key} in the committed pack`,
        ).toBeDefined();
        expect(record?.kind).toBe('rule');
        const data = record?.data as { text?: unknown };
        expect(typeof data.text).toBe('string');
        expect(data.text).toContain(expected.bodyPhrase);
        if (expected.excludedPhrase !== undefined) {
          expect(data.text).not.toContain(expected.excludedPhrase);
        }
        expect(record?.provenance.locator).toBe(expected.locator);
      });
    }

    // Each entry: the record whose body used to absorb the box, and a phrase
    // unique to the dropped callout-box prose that must no longer appear.
    const cases: ReadonlyArray<readonly [key: string, boxPhrase: string]> = [
      [
        'subclass:school-of-evocation',
        'Your spellbook is a unique compilation',
      ],
      [
        'feature:school-of-evocation:overchannel',
        'Copying a Spell into the Book',
      ],
      ['subclass:the-fiend', 'Pact of the Chain'],
      ['feature:the-fiend:hurl-through-hell', 'Your Pact Boon'],
      ['subclass:circle-of-the-land', 'Sacred Plants and Wood'],
      ['feature:circle-of-the-land:natural-recovery', 'Druids and the Gods'],
      ['feature:oath-of-devotion:holy-nimbus', 'Breaking Your Oath'],
    ];

    for (const [key, boxPhrase] of cases) {
      it(`bounds ${key} before the callout-box prose`, () => {
        expect(bodyOf(key)).not.toContain(boxPhrase);
      });
    }

    it('keeps the bounded School of Evocation content intact up to Overchannel', () => {
      // The subclass body still ends with its last feature (Overchannel), and
      // the Overchannel feature record still carries its full 14th-level text —
      // the fix removes only the trailing sidebar, not real subclass content.
      const subclass = bodyOf('subclass:school-of-evocation');
      expect(subclass).toContain('You focus your study on magic');
      expect(subclass).toContain('This damage ignores resistance and immunity');
      expect(bodyOf('feature:school-of-evocation:overchannel')).toContain(
        'you can deal maximum damage with that spell',
      );
    });
  });

  // loreweaver-6ra: the gamemastering Diseases and Poisons sections emit under
  // the `hazard` kind (alongside the 8 traps), discriminated by `data.category`.
  // These assertions guard exact name-set coverage, the category discriminators,
  // and the structured poison fields — plus the p205 reading-order fix that the
  // extractor change (the inline lead-in single-column merge) made possible.
  describe('gamemastering hazards: diseases + poisons (loreweaver-6ra)', () => {
    const hazards = pack.records.filter((r) => r.kind === 'hazard');
    const dataOf = (key: string) =>
      pack.records.find((r) => r.key === key)?.data as
        | Record<string, unknown>
        | undefined;

    it('emits every sample disease, keyed under the hazard kind', () => {
      const diseases = hazards.filter(
        (r) => (r.data as { category?: unknown }).category === 'disease',
      );
      expect(diseases.map((r) => r.name).sort()).toEqual(
        [...EXPECTED_SRD_5_1_DISEASE_NAMES].sort(),
      );
    });

    it('emits every sample poison, keyed under the hazard kind', () => {
      const poisons = hazards.filter(
        (r) => (r.data as { category?: unknown }).category === 'poison',
      );
      expect(poisons.map((r) => r.name).sort()).toEqual(
        [...EXPECTED_SRD_5_1_POISON_NAMES].sort(),
      );
    });

    it('disease and poison name baselines have no duplicates and no key collisions', () => {
      expect(new Set(EXPECTED_SRD_5_1_DISEASE_NAMES).size).toBe(
        EXPECTED_SRD_5_1_DISEASE_NAMES.length,
      );
      expect(new Set(EXPECTED_SRD_5_1_POISON_NAMES).size).toBe(
        EXPECTED_SRD_5_1_POISON_NAMES.length,
      );
      // hazard keys (8 traps + 3 diseases + 14 poisons) are all distinct.
      const keys = hazards.map((r) => r.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('carries structured poisonType and price on every poison', () => {
      for (const name of EXPECTED_SRD_5_1_POISON_NAMES) {
        const data = dataOf(
          `hazard:${name
            .toLowerCase()
            .replace(/[’']/g, '')
            .replace(/[^a-z0-9]+/g, '-')}`,
        );
        expect(data, `expected a record for ${name}`).toBeDefined();
        expect(typeof data?.poisonType).toBe('string');
        expect(['contact', 'ingested', 'inhaled', 'injury']).toContain(
          data?.poisonType,
        );
        expect(typeof data?.price).toBe('string');
        expect(data?.price as string).toMatch(/gp$/);
      }
    });

    it('keeps traps free of a category and diseases/poisons free of trapType', () => {
      for (const r of hazards) {
        const data = r.data as { category?: unknown; trapType?: unknown };
        if (data.trapType !== undefined) {
          expect(data.category).toBeUndefined();
        } else {
          expect(['disease', 'poison']).toContain(data.category);
        }
      }
    });

    it('reconstructs the p205 Sample Poisons in source order (inline lead-in fix)', () => {
      // Before the extractor fix, page 205 was split into a phantom right column
      // and each poison's bold lead-in remainder was emitted AFTER its body,
      // scrambling the first sentence (e.g. "Pale Tincture" lost "A creature
      // subjected to", and Truth Serum's trailing "spell." was displaced).
      const pale = dataOf('hazard:pale-tincture')?.description as string;
      expect(pale).toMatch(
        /^A creature subjected to this poison must succeed on a DC 16/,
      );
      const truth = dataOf('hazard:truth-serum')?.description as string;
      expect(truth).toMatch(
        /as if under the effect of a zone of truth spell\.$/,
      );
      const wyvern = dataOf('hazard:wyvern-poison')?.description as string;
      expect(wyvern).toMatch(
        /^This poison must be harvested from a dead or incapacitated wyvern\./,
      );
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

  // The canonical table set is Difficulty Classes, two trap tables, three
  // Madness tables, and two Objects tables. XP/treasure reconstruction remains
  // fixture-only because those families are absent from this SRD source.
  describe('table coverage regression baseline (loreweaver-46m, loreweaver-hvp, loreweaver-uuk)', () => {
    const tables = pack.records.filter((record) => record.kind === 'table');

    function table(key: string) {
      const record = tables.find((candidate) => candidate.key === key);
      expect(record, `expected ${key} in the committed pack`).toBeDefined();
      return record;
    }

    it('contains exactly the reviewed table key set', () => {
      expect(tables.map((record) => record.key).sort()).toEqual([
        'table:character-advancement',
        'table:damage-severity-by-level',
        'table:difficulty-classes',
        'table:exotic-languages',
        'table:food-drink-and-lodging',
        'table:indefinite-madness',
        'table:lifestyle-expenses',
        'table:long-term-madness',
        'table:multiclass-spellcaster-spell-slots-per-spell-level',
        'table:multiclassing-prerequisites',
        'table:multiclassing-proficiencies',
        'table:object-armor-class',
        'table:object-hit-points',
        'table:services',
        'table:short-term-madness',
        'table:standard-exchange-rates',
        'table:standard-languages',
        'table:trade-goods',
        'table:trap-save-dcs-and-attack-bonuses',
      ]);
    });

    it('contains exactly the reviewed table name set', () => {
      expect(tables.map((record) => record.name).sort()).toEqual(
        [...EXPECTED_SRD_5_1_TABLE_NAMES].sort(),
      );
      expect(new Set(EXPECTED_SRD_5_1_TABLE_NAMES).size).toBe(
        EXPECTED_SRD_5_1_TABLE_NAMES.length,
      );
    });

    it('the table count matches the per-kind baseline', () => {
      expect(tables).toHaveLength(EXPECTED_COUNTS_BY_KIND.table);
    });

    it('pins Madness table row counts, representative data, and source pages', () => {
      const shortTerm = table('table:short-term-madness');
      const longTerm = table('table:long-term-madness');
      const indefinite = table('table:indefinite-madness');

      expect(shortTerm?.data).toMatchObject({
        columns: ['d100', 'Effect'],
        rows: expect.arrayContaining([
          ['81–90', 'The character is stunned.'],
          ['91–100', 'The character falls unconscious.'],
        ]),
      });
      expect((shortTerm?.data as { rows: unknown[] }).rows).toHaveLength(10);
      expect(shortTerm?.provenance.locator).toBe('p. 201');

      expect(longTerm?.data).toMatchObject({
        columns: ['d100', 'Effect'],
        rows: expect.arrayContaining([
          ['91–95', 'The character loses the ability to speak.'],
        ]),
      });
      expect((longTerm?.data as { rows: unknown[] }).rows).toHaveLength(12);
      expect(longTerm?.provenance.locator).toBe('p. 201');

      expect(indefinite?.data).toMatchObject({
        columns: ['d100', 'Flaw'],
        rows: expect.arrayContaining([['16–25', '“I keep whatever I find.”']]),
      });
      expect((indefinite?.data as { rows: unknown[] }).rows).toHaveLength(12);
      expect(indefinite?.provenance.locator).toBe('p. 202');
    });

    it('pins Objects table data and source pages', () => {
      const armorClass = table('table:object-armor-class');
      expect(armorClass?.data).toMatchObject({
        columns: ['Substance', 'AC'],
        rows: expect.arrayContaining([['Adamantine', 23]]),
      });
      expect((armorClass?.data as { rows: unknown[] }).rows).toHaveLength(7);
      expect(armorClass?.provenance.locator).toBe('p. 203');

      const hitPoints = table('table:object-hit-points');
      expect(hitPoints?.data).toMatchObject({
        columns: ['Size', 'Fragile', 'Resilient'],
        rows: expect.arrayContaining([
          ['Large (cart, 10-ft.-by-10-ft. window)', '5 (1d10)', '27 (5d10)'],
        ]),
      });
      expect((hitPoints?.data as { rows: unknown[] }).rows).toHaveLength(4);
      expect(hitPoints?.provenance.locator).toBe('p. 203');
    });

    it('pins Beyond-1st-Level table data and source pages (eshyra-0m9.23)', () => {
      const advancement = table('table:character-advancement');
      expect(advancement?.data).toMatchObject({
        columns: ['Experience Points', 'Level', 'Proficiency Bonus'],
        rows: expect.arrayContaining([
          [0, 1, '+2'],
          [2700, 4, '+2'],
          [355000, 20, '+6'],
        ]),
      });
      expect((advancement?.data as { rows: unknown[] }).rows).toHaveLength(20);
      expect(advancement?.provenance.locator).toBe('p. 56');

      const prerequisites = table('table:multiclassing-prerequisites');
      expect(prerequisites?.data).toMatchObject({
        columns: ['Class', 'Ability Score Minimum'],
        rows: expect.arrayContaining([
          ['Fighter', 'Strength 13 or Dexterity 13'],
          ['Monk', 'Dexterity 13 and Wisdom 13'],
        ]),
      });
      expect((prerequisites?.data as { rows: unknown[] }).rows).toHaveLength(
        12,
      );
      expect(prerequisites?.provenance.locator).toBe('p. 56');

      const proficiencies = table('table:multiclassing-proficiencies');
      expect(proficiencies?.data).toMatchObject({
        columns: ['Class', 'Proficiencies Gained'],
        // The Bard cell wraps across two extracted lines and must rejoin; the
        // Sorcerer cell is the verbatim "—" (no proficiencies).
        rows: expect.arrayContaining([
          [
            'Bard',
            'Light armor, one skill of your choice, one musical instrument of your choice',
          ],
          ['Sorcerer', '—'],
        ]),
      });
      expect((proficiencies?.data as { rows: unknown[] }).rows).toHaveLength(
        12,
      );
      expect(proficiencies?.provenance.locator).toBe('p. 57');

      const standard = table('table:standard-languages');
      expect(standard?.data).toMatchObject({
        columns: ['Language', 'Typical Speakers', 'Script'],
        rows: expect.arrayContaining([['Giant', 'Ogres, giants', 'Dwarvish']]),
      });
      expect((standard?.data as { rows: unknown[] }).rows).toHaveLength(8);
      expect(standard?.provenance.locator).toBe('p. 59');

      const exotic = table('table:exotic-languages');
      expect(exotic?.data).toMatchObject({
        columns: ['Language', 'Typical Speakers', 'Script'],
        // "Deep Speech" is a two-word language name and its script cell is "—".
        rows: expect.arrayContaining([
          ['Deep Speech', 'Aboleths, cloakers', '—'],
        ]),
      });
      expect((exotic?.data as { rows: unknown[] }).rows).toHaveLength(8);
      expect(exotic?.provenance.locator).toBe('p. 59');
    });

    it('pins the Multiclass Spellcaster spell-slot progression (eshyra-0m9.18)', () => {
      const slots = table(
        'table:multiclass-spellcaster-spell-slots-per-spell-level',
      );
      expect(slots?.name).toBe(
        'Multiclass Spellcaster: Spell Slots per Spell Level',
      );
      expect(slots?.data).toMatchObject({
        columns: [
          'Lvl.',
          '1st',
          '2nd',
          '3rd',
          '4th',
          '5th',
          '6th',
          '7th',
          '8th',
          '9th',
        ],
        // Slot counts are integers; "no slots at this level" em-dash cells
        // are preserved verbatim.
        rows: expect.arrayContaining([
          ['1st', 2, '—', '—', '—', '—', '—', '—', '—', '—'],
          ['9th', 4, 3, 3, 3, 1, '—', '—', '—', '—'],
          ['20th', 4, 3, 3, 3, 3, 2, 2, 1, 1],
        ]),
      });
      expect((slots?.data as { rows: unknown[] }).rows).toHaveLength(20);
      expect(slots?.provenance.locator).toBe('p. 58');
    });

    it('pins money/downtime table data and source pages (eshyra-0m9.19)', () => {
      const exchange = table('table:standard-exchange-rates');
      expect(exchange?.data).toMatchObject({
        columns: ['Coin', 'CP', 'SP', 'EP', 'GP', 'PP'],
        // Fractional cross-rate cells are preserved verbatim as strings.
        rows: expect.arrayContaining([
          ['Copper (cp)', '1', '1/10', '1/50', '1/100', '1/1,000'],
        ]),
      });
      expect((exchange?.data as { rows: unknown[] }).rows).toHaveLength(5);
      expect(exchange?.provenance.locator).toBe('p. 62');

      const trade = table('table:trade-goods');
      expect(trade?.data).toMatchObject({
        columns: ['Cost', 'Goods'],
        rows: expect.arrayContaining([
          ['1 cp', '1 lb. of wheat'],
          ['500 gp', '1 lb. of platinum'],
        ]),
      });
      expect((trade?.data as { rows: unknown[] }).rows).toHaveLength(13);
      expect(trade?.provenance.locator).toBe('p. 72');

      const lifestyle = table('table:lifestyle-expenses');
      expect(lifestyle?.data).toMatchObject({
        columns: ['Lifestyle', 'Price/Day'],
        // The "—" (Wretched) and "10 gp minimum" (Aristocratic) cells are
        // preserved verbatim.
        rows: expect.arrayContaining([
          ['Wretched', '—'],
          ['Aristocratic', '10 gp minimum'],
        ]),
      });
      expect((lifestyle?.data as { rows: unknown[] }).rows).toHaveLength(7);
      expect(lifestyle?.provenance.locator).toBe('p. 72');

      const food = table('table:food-drink-and-lodging');
      expect(food?.data).toMatchObject({
        columns: ['Item', 'Cost'],
        // Grouped sub-items fold into qualified, query-friendly names; ungrouped
        // top-level items keep their bare name.
        rows: expect.arrayContaining([
          ['Ale, gallon', '2 sp'],
          ['Inn stay, squalid (per day)', '7 cp'],
          ['Meat, chunk', '3 sp'],
          ['Wine, fine (bottle)', '10 gp'],
        ]),
      });
      expect((food?.data as { rows: unknown[] }).rows).toHaveLength(20);
      expect(food?.provenance.locator).toBe('p. 73');

      const services = table('table:services');
      expect(services?.data).toMatchObject({
        columns: ['Service', 'Pay'],
        rows: expect.arrayContaining([
          ['Coach cab, between towns', '3 cp per mile'],
          ['Hireling, skilled', '2 gp per day'],
          ['Messenger', '2 cp per mile'],
        ]),
      });
      expect((services?.data as { rows: unknown[] }).rows).toHaveLength(7);
      expect(services?.provenance.locator).toBe('p. 74');
    });

    it('emits Spellcasting Services as a rule rather than lost prose (eshyra-0m9.19)', () => {
      const rule = pack.records.find(
        (record) => record.key === 'rule:spellcasting-services',
      );
      expect(
        rule,
        'expected rule:spellcasting-services in the pack',
      ).toBeDefined();
      expect(rule?.kind).toBe('rule');
      expect(rule?.name).toBe('Spellcasting Services');
      const text = (rule?.data as { text: string }).text;
      expect(text).toContain('no established pay rates exist');
      expect(text).toContain('10 to 50 gold pieces');
      // The body is one reflowed block bounded by the Feats chapter — no
      // "Feats" heading should bleed in.
      expect(text).not.toContain('Feats');
      expect(rule?.provenance.locator).toBe('p. 74');
    });
  });

  describe('Beyond 1st Level character rules (eshyra-0m9.18)', () => {
    function ruleText(key: string): string {
      const record = pack.records.find(
        (candidate) => candidate.kind === 'rule' && candidate.key === key,
      );
      expect(record, `expected ${key} in the committed pack`).toBeDefined();
      return (record?.data as { text: string }).text;
    }

    it('emits the chapter intro as the character-advancement rule', () => {
      // The "Beyond 1st Level" chapter intro precedes any heading in the
      // slice, so it is emitted via parseRules's chapterIntro option. It IS
      // the SRD's advancement prose: gaining levels, the ability-score cap,
      // and per-level hit-point increases.
      const text = ruleText('rule:beyond-1st-level');
      expect(text).toContain('This advancement is called gaining a level.');
      expect(text).toContain('can’t increase an ability score above 20');
      expect(text).toContain('you gain 1 additional Hit Die');
      // The Character Advancement table that follows the intro is its own
      // `table` record; its rows must not bleed into the intro body.
      expect(text).not.toContain('305,000');
      const record = pack.records.find(
        (candidate) => candidate.key === 'rule:beyond-1st-level',
      );
      expect(record?.name).toBe('Beyond 1st Level');
      expect(record?.provenance.locator).toBe('p. 56');
    });

    it('emits the multiclassing rule tree with parent-qualified collisions', () => {
      expect(ruleText('rule:multiclassing')).toContain(
        'gain levels in multiple classes',
      );
      expect(ruleText('rule:prerequisites')).toContain(
        'ability score prerequisites for both your current class',
      );
      expect(ruleText('rule:experience-points')).toContain(
        'cleric 6/fighter 1',
      );
      expect(ruleText('rule:hit-points-and-hit-dice')).toContain(
        'pool of Hit Dice',
      );
      expect(ruleText('rule:proficiencies')).toContain(
        'only some of new class’s starting proficiencies',
      );
      expect(ruleText('rule:class-features')).toContain(
        'Channel Divinity, Extra Attack, Unarmored Defense, and Spellcasting',
      );
      // The chapter's "Proficiency Bonus" title collides with the core-rules
      // rule:proficiency-bonus, so it parent-qualifies; both records coexist
      // with distinct bodies.
      const multiclassPb = ruleText('rule:multiclassing-proficiency-bonus');
      expect(multiclassPb).toContain('fighter 3/rogue 2');
      const corePb = ruleText('rule:proficiency-bonus');
      expect(corePb).not.toContain('fighter 3/rogue 2');
    });

    it('keeps the multiclass Spellcasting rule complete and free of the slot table', () => {
      const text = ruleText('rule:spellcasting');
      // The run-in bold leads ("Spells Known and Prepared.", "Spell Slots.",
      // "Pact Magic.") are body paragraphs, not headings — they stay in this
      // record.
      expect(text).toContain('Spells Known and Prepared.');
      expect(text).toContain('Spell Slots.');
      expect(text).toContain('Pact Magic.');
      // The Multiclass Spellcaster table that follows is its own `table`
      // record; neither its caption nor its rows bleed in.
      expect(text).not.toContain('Lvl.');
      expect(text).not.toContain('Spell Slots per Spell Level');
    });

    it('emits the Alignment, Languages, and Inspiration sections', () => {
      const alignment = ruleText('rule:alignment');
      expect(alignment).toContain('nine distinct alignments');
      expect(alignment).toContain('Chaotic evil (CE)');
      // The "Alignment in the Multiverse" leaf is its own record, not part of
      // the parent body.
      expect(alignment).not.toContain('unaligned');
      expect(ruleText('rule:alignment-in-the-multiverse')).toContain(
        'unaligned',
      );

      const languages = ruleText('rule:languages');
      expect(languages).toContain('thieves’ cant');
      // The Standard/Exotic Languages tables are table records; no row text.
      expect(languages).not.toContain('Dwarvish Dwarves');

      expect(ruleText('rule:inspiration')).toContain(
        'reward you for playing your character',
      );
      expect(ruleText('rule:gaining-inspiration')).toContain(
        'can’t stockpile multiple “inspirations”',
      );
      expect(ruleText('rule:using-inspiration')).toContain(
        'gives you advantage on that roll',
      );
    });

    it('keeps the chapter table captions out of the rule kind', () => {
      const ruleNames = new Set(
        pack.records
          .filter((record) => record.kind === 'rule')
          .map((record) => record.name),
      );
      for (const caption of [
        'Character Advancement',
        'Multiclassing Prerequisites',
        'Multiclassing Proficiencies',
        'Multiclass Spellcaster:',
        'Spell Slots per Spell Level',
        'Standard Languages',
        'Exotic Languages',
      ]) {
        expect(ruleNames.has(caption), `no rule named "${caption}"`).toBe(
          false,
        );
      }
    });
  });

  describe('Magic Items usage rules (eshyra-0m9.21)', () => {
    function ruleRecord(key: string) {
      const record = pack.records.find(
        (candidate) => candidate.kind === 'rule' && candidate.key === key,
      );
      expect(record, `expected ${key} in the committed pack`).toBeDefined();
      return record;
    }

    function ruleText(key: string): string {
      return (ruleRecord(key)?.data as { text: string }).text;
    }

    it('emits the chapter intro as rule:magic-items with p206 provenance', () => {
      const record = ruleRecord('rule:magic-items');
      expect(record?.name).toBe('Magic Items');
      expect(record?.provenance.locator).toBe('p. 206');
      const text = ruleText('rule:magic-items');
      expect(text).toContain('gleaned from the hoards of conquered monsters');
      // The intro is bounded at the first heading; the Attunement body must
      // not bleed in.
      expect(text).not.toContain('attunement');
    });

    it('keeps the complete Attunement rule as one record', () => {
      const text = ruleText('rule:attunement');
      // The four pillars of the SRD attunement rules, in one body: the bond
      // and its prerequisites, the short-rest procedure, the three-item
      // limit, and how attunement ends.
      expect(text).toContain('This bond is called attunement');
      expect(text).toContain(
        'requires a creature to spend a short rest focused on only that item',
      );
      expect(text).toContain('no more than three magic items at a time');
      expect(text).toContain('more than 100 feet away for at least 24 hours');
      // Bounded at the next section heading.
      expect(text).not.toContain('Wearing and Wielding');
      expect(ruleRecord('rule:attunement')?.provenance.locator).toBe('p. 206');
    });

    it('emits the wearing/wielding tree with its leaves as separate records', () => {
      const wearing = ruleText('rule:wearing-and-wielding-items');
      expect(wearing).toContain('must be donned in the intended fashion');
      // The two h≈13.9 leaves are their own records, not part of the parent.
      expect(wearing).not.toContain('more than one pair of footwear');
      expect(ruleText('rule:multiple-items-of-the-same-kind')).toContain(
        'more than one pair of footwear',
      );
      expect(ruleText('rule:paired-items')).toContain(
        'impart their benefits only if both items of the pair are worn',
      );
    });

    it('emits the activation tree with its four leaves as separate records', () => {
      const activating = ruleText('rule:activating-an-item');
      expect(activating).toContain(
        'rogue’s Fast Hands can’t be used to activate the item',
      );
      expect(ruleText('rule:command-word')).toContain(
        'can’t be activated in an area where sound is prevented',
      );
      expect(ruleText('rule:consumables')).toContain(
        'Once used, a consumable item loses its magic',
      );
      // rule:spells is the "Activating an Item > Spells" leaf: casting a
      // spell FROM an item.
      const spells = ruleText('rule:spells');
      expect(spells).toContain('cast at the lowest possible spell level');
      expect(spells).toContain(
        'your spellcasting ability modifier is +0 for the item',
      );
      const charges = ruleText('rule:charges');
      expect(charges).toContain('revealed when an identify spell is cast');
      // Charges is the chapter's last rule; the A-Z slice owns everything
      // after the "Magic Items A-Z" boundary, so no item entry bleeds in.
      expect(charges).not.toContain('Adamantine');
      expect(ruleRecord('rule:charges')?.provenance.locator).toBe('p. 207');
    });
  });

  describe('Traps general rules (eshyra-0m9.20)', () => {
    function ruleRecord(key: string) {
      const record = pack.records.find(
        (candidate) => candidate.kind === 'rule' && candidate.key === key,
      );
      expect(record, `expected ${key} in the committed pack`).toBeDefined();
      return record;
    }

    function ruleText(key: string): string {
      return (ruleRecord(key)?.data as { text: string }).text;
    }

    it('emits the chapter intro as rule:traps with p195 provenance', () => {
      const record = ruleRecord('rule:traps');
      expect(record?.name).toBe('Traps');
      expect(record?.provenance.locator).toBe('p. 195');
      const text = ruleText('rule:traps');
      // The intro describes what traps are; bounded at the first heading.
      expect(text).toContain('trap');
      expect(text).not.toContain('Traps in Play');
    });

    it('emits rule:traps-in-play with body bounded at next heading', () => {
      const text = ruleText('rule:traps-in-play');
      expect(text.length).toBeGreaterThan(0);
      // Must not bleed into Triggering a Trap.
      expect(text).not.toContain('Triggering a Trap');
    });

    it('emits rule:triggering-a-trap and rule:detecting-and-disabling-a-trap', () => {
      expect(ruleText('rule:triggering-a-trap').length).toBeGreaterThan(0);
      expect(
        ruleText('rule:detecting-and-disabling-a-trap').length,
      ).toBeGreaterThan(0);
    });

    it('emits rule:trap-effects without emitting the two table captions as rules', () => {
      const text = ruleText('rule:trap-effects');
      expect(text.length).toBeGreaterThan(0);
      // TABLE_CAPTION_LEAF_TITLES prevents the two h≈12 table caption headings
      // from being emitted as standalone rule records — the `table` kind owns
      // those. The caption names DO appear in the "Trap Effects" body prose as
      // SRD cross-references; checking keys rather than body text is correct.
      const ruleKeys = pack.records
        .filter((r) => r.kind === 'rule')
        .map((r) => r.key);
      expect(ruleKeys).not.toContain('rule:trap-save-dcs-and-attack-bonuses');
      expect(ruleKeys).not.toContain('rule:damage-severity-by-level');
    });

    it('emits rule:complex-traps without leaking sample-trap entries', () => {
      const text = ruleText('rule:complex-traps');
      expect(text.length).toBeGreaterThan(0);
      // The slice is truncated before "Sample Traps"; no sample trap name
      // should appear in the complex-traps rule body.
      expect(text).not.toContain('Collapsing Roof');
    });

    it('keeps sample traps as hazard records only', () => {
      // The slice is bounded before "Sample Traps", so no sample trap name
      // appears as a rule key.
      const ruleKeys = pack.records
        .filter((r) => r.kind === 'rule')
        .map((r) => r.key);
      expect(ruleKeys).not.toContain('rule:collapsing-roof');
      expect(ruleKeys).not.toContain('rule:sphere-of-annihilation');
      expect(ruleKeys).not.toContain('rule:sample-traps');
      // All 8 sample traps remain as hazard records.
      expect(
        pack.records.find((r) => r.key === 'hazard:collapsing-roof'),
      ).toBeDefined();
      expect(
        pack.records.find((r) => r.key === 'hazard:sphere-of-annihilation'),
      ).toBeDefined();
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
