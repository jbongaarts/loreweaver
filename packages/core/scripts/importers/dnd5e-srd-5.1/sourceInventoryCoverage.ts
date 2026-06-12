/**
 * SRD source-coverage evaluation (eshyra-4a7.1).
 *
 * Gate half of the source-coverage pair: takes the typography-derived
 * inventory (sourceInventory.ts) plus the emitted records and decides, for
 * every source item, exactly one accounting status:
 *
 *   - `record`     — an emitted top-level record covers it (name auto-match);
 *   - `child-of`   — represented as structured child data on a record;
 *   - `ignored`    — intentionally not a record, with a stable reason code;
 *   - `known-gap`  — SHOULD become a record/child but doesn't yet; carries the
 *                    bead id of the work that will close it. When that bead
 *                    lands, its rule is removed so the gate starts enforcing
 *                    the new coverage;
 *   - `unaccounted`— nothing claims it. `assertSourceCoverage` fails closed.
 *
 * Resolution order: name auto-match first (an emitted record always wins),
 * then the caller's rules in order (first match wins), then the
 * document-structure default for chapter/section tiers, else unaccounted.
 *
 * Rules are PREDICATES with stable reason codes, not per-item lists: one rule
 * accounts for a whole class of source items (e.g. every spell-list header),
 * which keeps curation reviewable and means a NEW source item of an already
 * understood shape is auto-accounted while a genuinely novel one fails the
 * gate. Everything is pure and deterministic; entries are sorted in reading
 * order so reports diff cleanly.
 */

import type { SourceInventoryItem } from './sourceInventory.js';

export type CoverageStatus =
  | { readonly kind: 'record'; readonly key: string }
  | { readonly kind: 'child-of'; readonly key: string }
  | { readonly kind: 'ignored'; readonly reason: string }
  | { readonly kind: 'known-gap'; readonly beadId: string }
  | { readonly kind: 'unaccounted' };

/** Minimal record shape the evaluator needs (subset of RulesRecord). */
export interface CoverageRecordRef {
  readonly kind: string;
  readonly key: string;
  readonly name: string;
}

export interface SourceCoverageEntry {
  readonly item: SourceInventoryItem;
  readonly status: CoverageStatus;
}

export type CoverageRule =
  | {
      readonly type: 'ignore';
      readonly reason: string;
      readonly match: (item: SourceInventoryItem) => boolean;
    }
  | {
      readonly type: 'known-gap';
      readonly beadId: string;
      readonly match: (item: SourceInventoryItem) => boolean;
    }
  | {
      readonly type: 'child-of';
      readonly key: string;
      readonly match: (item: SourceInventoryItem) => boolean;
    }
  | {
      readonly type: 'record';
      readonly key: string;
      readonly match: (item: SourceInventoryItem) => boolean;
    };

export function ignoreRule(
  reason: string,
  match: (item: SourceInventoryItem) => boolean,
): CoverageRule {
  return { type: 'ignore', reason, match };
}

export function knownGapRule(
  beadId: string,
  match: (item: SourceInventoryItem) => boolean,
): CoverageRule {
  return { type: 'known-gap', beadId, match };
}

export function childOfRule(
  key: string,
  match: (item: SourceInventoryItem) => boolean,
): CoverageRule {
  return { type: 'child-of', key, match };
}

/**
 * Map a source item to an emitted record whose NAME differs from the source
 * heading text, so the name auto-match cannot claim it — e.g. the SRD's
 * "Lightfoot" subrace heading vs the emitted `ancestry:lightfoot-halfling`
 * record named "Lightfoot Halfling".
 */
export function recordRule(
  key: string,
  match: (item: SourceInventoryItem) => boolean,
): CoverageRule {
  return { type: 'record', key, match };
}

/**
 * Normalize text for name matching: case-fold, straighten curly quotes,
 * collapse whitespace. Hyphen clusters are already collapsed at the
 * extraction boundary (extract.ts `normalizePdfHyphenCluster`).
 */
function normalizeName(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function statusForRule(rule: CoverageRule): CoverageStatus {
  switch (rule.type) {
    case 'ignore':
      return { kind: 'ignored', reason: rule.reason };
    case 'known-gap':
      return { kind: 'known-gap', beadId: rule.beadId };
    case 'child-of':
      return { kind: 'child-of', key: rule.key };
    case 'record':
      return { kind: 'record', key: rule.key };
  }
}

/**
 * Evaluate coverage for every inventory item. See the module header for the
 * resolution order. Entries come back sorted by (page, lineIndex).
 */
export function evaluateSourceCoverage(
  inventory: readonly SourceInventoryItem[],
  records: readonly CoverageRecordRef[],
  rules: readonly CoverageRule[],
): readonly SourceCoverageEntry[] {
  // name -> lexicographically-first record key. Duplicate names (e.g. the
  // per-class "Ability Score Improvement" features) resolve deterministically;
  // for accounting purposes any emitted record with the name covers the item.
  const keyByName = new Map<string, string>();
  for (const record of records) {
    const name = normalizeName(record.name);
    const existing = keyByName.get(name);
    if (existing === undefined || record.key < existing) {
      keyByName.set(name, record.key);
    }
  }

  const entries = inventory.map((item): SourceCoverageEntry => {
    const matchedKey = keyByName.get(normalizeName(item.text));
    if (matchedKey !== undefined) {
      return { item, status: { kind: 'record', key: matchedKey } };
    }
    for (const rule of rules) {
      if (rule.match(item)) {
        return { item, status: statusForRule(rule) };
      }
    }
    if (item.tier === 'chapter' || item.tier === 'section') {
      return {
        item,
        status: { kind: 'ignored', reason: 'document-structure' },
      };
    }
    return { item, status: { kind: 'unaccounted' } };
  });

  return entries.sort(
    (a, b) => a.item.page - b.item.page || a.item.lineIndex - b.item.lineIndex,
  );
}

export class SourceInventoryCoverageError extends Error {
  constructor(unaccounted: readonly SourceCoverageEntry[]) {
    const lines = unaccounted.map(({ item }) => {
      const tier = item.tier ?? 'table';
      const section =
        item.section === null ? '' : ` (section: ${item.section})`;
      return `  p${item.page}#${item.lineIndex} [${tier}/${item.structure}] "${item.text}"${section}`;
    });
    super(
      `SRD source inventory has ${unaccounted.length} unaccounted item(s) — every source structure must be emitted, mapped to child data, ignored with a reason, or tracked as a known gap:\n${lines.join('\n')}`,
    );
    this.name = 'SourceInventoryCoverageError';
  }
}

/** Throw when any entry is unaccounted; the import must fail closed. */
export function assertSourceCoverage(
  entries: readonly SourceCoverageEntry[],
): void {
  const unaccounted = entries.filter((e) => e.status.kind === 'unaccounted');
  if (unaccounted.length > 0) {
    throw new SourceInventoryCoverageError(unaccounted);
  }
}

/**
 * One-line status form used in the `source-coverage.json` artifact and the
 * sentinel regression tests: `record:<key>` | `child-of:<key>` |
 * `ignored:<reason>` | `known-gap:<beadId>` | `unaccounted`.
 */
export function formatCoverageStatus(status: CoverageStatus): string {
  switch (status.kind) {
    case 'record':
      return `record:${status.key}`;
    case 'child-of':
      return `child-of:${status.key}`;
    case 'ignored':
      return `ignored:${status.reason}`;
    case 'known-gap':
      return `known-gap:${status.beadId}`;
    case 'unaccounted':
      return 'unaccounted';
  }
}

/** JSON shape of one `source-coverage.json` entry. */
export interface SourceCoverageReportEntry {
  readonly page: number;
  readonly lineIndex: number;
  readonly tier: string | null;
  readonly structure: string;
  readonly text: string;
  readonly section: string | null;
  readonly status: string;
}

/** JSON shape of the `source-coverage.json` artifact. */
export interface SourceCoverageReport {
  readonly summary: {
    readonly record: number;
    readonly childOf: number;
    readonly ignored: Readonly<Record<string, number>>;
    readonly knownGap: Readonly<Record<string, number>>;
    readonly unaccounted: number;
  };
  readonly entries: readonly SourceCoverageReportEntry[];
}

/**
 * Build the reviewer-facing coverage report: a roll-up of statuses (per
 * ignore reason and per known-gap bead) followed by every entry in reading
 * order. Pure and deterministic — sub-summary keys are sorted so the emitted
 * JSON is byte-stable for identical input.
 */
export function buildSourceCoverageReport(
  entries: readonly SourceCoverageEntry[],
): SourceCoverageReport {
  let record = 0;
  let childOf = 0;
  let unaccounted = 0;
  const ignored = new Map<string, number>();
  const knownGap = new Map<string, number>();
  for (const { status } of entries) {
    switch (status.kind) {
      case 'record':
        record += 1;
        break;
      case 'child-of':
        childOf += 1;
        break;
      case 'ignored':
        ignored.set(status.reason, (ignored.get(status.reason) ?? 0) + 1);
        break;
      case 'known-gap':
        knownGap.set(status.beadId, (knownGap.get(status.beadId) ?? 0) + 1);
        break;
      case 'unaccounted':
        unaccounted += 1;
        break;
    }
  }
  const sortedCounts = (
    counts: ReadonlyMap<string, number>,
  ): Record<string, number> =>
    Object.fromEntries(
      [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  return {
    summary: {
      record,
      childOf,
      ignored: sortedCounts(ignored),
      knownGap: sortedCounts(knownGap),
      unaccounted,
    },
    entries: entries.map(({ item, status }) => ({
      page: item.page,
      lineIndex: item.lineIndex,
      tier: item.tier,
      structure: item.structure,
      text: item.text,
      section: item.section,
      status: formatCoverageStatus(status),
    })),
  };
}

// ---------------------------------------------------------------------------
// Curated coverage rules for the vendored SRD 5.1 PDF (eshyra-4a7.1.3).
//
// Resolution order matters: the name auto-match runs before any rule (an
// emitted record always claims its own heading), then these rules apply
// first-match-wins. Rules are predicates over understood CLASSES of source
// structure, not per-item allowlists, so a new item of an already-understood
// shape is auto-accounted while a genuinely novel structure stays
// unaccounted and fails the import.
//
// Honesty contract (docs/importer-fix-protocol.md): `ignoreRule` is reserved
// for genuine non-content (structural headers whose content is represented
// elsewhere, documented intentional exclusions); anything that SHOULD become
// a record or structured child data carries a `knownGapRule` naming the bead
// that will close it — when that bead lands, its rule is deleted so the gate
// starts enforcing the new coverage.
// ---------------------------------------------------------------------------

/** The 12 class names; each renders at chapter tier, so it IS the `section`. */
const CLASS_CHAPTER_SECTIONS: ReadonlySet<string> = new Set([
  'Barbarian',
  'Bard',
  'Cleric',
  'Druid',
  'Fighter',
  'Monk',
  'Paladin',
  'Ranger',
  'Rogue',
  'Sorcerer',
  'Warlock',
  'Wizard',
]);

/**
 * "<Race> Traits" subsection headings: the trait content is structured child
 * data on the matching ancestry record (`data.traits`).
 */
const RACE_TRAIT_HEADINGS: ReadonlyArray<readonly [string, string]> = [
  ['Dwarf Traits', 'ancestry:dwarf'],
  ['Elf Traits', 'ancestry:elf'],
  ['Halfling Traits', 'ancestry:halfling'],
  ['Human Traits', 'ancestry:human'],
  ['Dragonborn Traits', 'ancestry:dragonborn'],
  ['Gnome Traits', 'ancestry:gnome'],
  ['Half-Elf Traits', 'ancestry:half-elf'],
  ['Half-Orc Traits', 'ancestry:half-orc'],
  ['Tiefling Traits', 'ancestry:tiefling'],
];

/** Spell-list level headers inside the per-class spell lists (p105-113). */
const SPELL_LIST_LEVEL_HEADER =
  /^(?:Cantrips \(0 Level\)|[1-9](?:st|nd|rd|th) Level)$/;

/** Spell-list class headers ("Bard Spells" … "Wizard Spells", p105-113). */
const SPELL_LIST_CLASS_HEADER =
  /^(?:Bard|Cleric|Druid|Paladin|Ranger|Sorcerer|Warlock|Wizard) Spells$/;

/**
 * Equipment-chapter reference tables whose ROWS are emitted as `equipment`
 * records (with `cost`/`weight`/`capacity`/pack-contents child data), so the
 * table itself is intentionally not a `table` record.
 */
const EQUIPMENT_ROWS_AS_RECORDS_CAPTIONS: ReadonlySet<string> = new Set([
  'Armor',
  'Weapons',
  'Adventuring Gear',
  'Container Capacity',
  'Equipment Packs',
  'Tools',
  'Mounts and Other Animals',
  'Tack, Harness, and Drawn Vehicles',
  'Waterborne Vehicles',
]);

/**
 * The seven Circle of the Land terrain spell tables (p22): the SRD prints
 * bare terrain-word captions ("Arctic") while the emitted records carry
 * qualified names ("Circle of the Land (Arctic)"), so the name auto-match
 * cannot claim the captions (eshyra-4a7.3).
 */
const CIRCLE_OF_THE_LAND_TABLE_TERRAINS: ReadonlyArray<
  readonly [string, string]
> = [
  ['Arctic', 'table:circle-of-the-land-arctic'],
  ['Coast', 'table:circle-of-the-land-coast'],
  ['Desert', 'table:circle-of-the-land-desert'],
  ['Forest', 'table:circle-of-the-land-forest'],
  ['Grassland', 'table:circle-of-the-land-grassland'],
  ['Mountain', 'table:circle-of-the-land-mountain'],
  ['Swamp', 'table:circle-of-the-land-swamp'],
];

/**
 * Caption-less magic-item tables emitted under their owning item's name
 * (eshyra-4a7.3): each surfaces in the inventory as a `table-shape` run whose
 * text is its column-header line, located by the owning item heading the
 * inventory records as `context`.
 */
const CAPTIONLESS_MAGIC_ITEM_TABLE_RECORDS: ReadonlyArray<
  readonly [string, string]
> = [
  ['Belt of Giant Strength', 'table:belt-of-giant-strength'],
  ['Potion of Giant Strength', 'table:potion-of-giant-strength'],
  ['Bag of Beans', 'table:bag-of-beans'],
  ['Robe of Useful Items', 'table:robe-of-useful-items'],
  ['Wand of Wonder', 'table:wand-of-wonder'],
];

/**
 * Unimported prose regions tracked by eshyra-4a7.10 (see that bead for the
 * region-by-region inventory). Grouped here so the predicates below stay
 * readable.
 */
const RACES_INTRO_PROSE_HEADINGS: ReadonlySet<string> = new Set([
  'Racial Traits', // p3 chapter intro explaining the trait categories below
  'Ability Score Increase',
  'Age',
  'Subraces',
]);
const EQUIPMENT_PROSE_HEADINGS: ReadonlySet<string> = new Set([
  'Getting Into and Out of Armor', // p64 prose (its Donning and Doffing table IS emitted — eshyra-4a7.3)
  'Weapon Proficiency', // p64
  'Weapon Properties', // p64-65 (defines the property tokens equipment records carry)
  'Improvised Weapons', // p65
  'Silvered Weapons', // p65
  'Special Weapons', // p65
]);
const SENTIENT_MAGIC_ITEM_HEADINGS: ReadonlySet<string> = new Set([
  'Creating Sentient Magic Items', // p251-252 DM guidance after the A-Z items
  'Abilities',
  'Communication',
  'Special Purpose',
  'Conflict',
]);

/**
 * Coverage rules for the real SRD 5.1 import. Every rule carries a comment
 * naming the source structures it accounts for; the committed
 * `source-coverage.json` artifact shows the resulting per-item statuses.
 */
export const SRD_5_1_COVERAGE_RULES: readonly CoverageRule[] = [
  // Pre-chapter legal front matter: the p1 "Legal Information" heading and
  // the p3 erratum line, both before the first chapter heading so their
  // `section` is null. Chapter-tier titles also carry a null section by
  // construction and are excluded here — the document-structure default
  // accounts for them.
  ignoreRule('front-matter', (i) => i.section === null && i.tier !== 'chapter'),
  // The SRD prints the Lightfoot Halfling subrace heading as bare "Lightfoot";
  // the emitted record is named "Lightfoot Halfling" so auto-match misses it.
  recordRule(
    'ancestry:lightfoot-halfling',
    (i) => i.section === 'Races' && i.text === 'Lightfoot',
  ),
  // The caption reads "Typical Difficulty Classes" in source; the emitted
  // table record is named "Difficulty Classes".
  recordRule(
    'table:difficulty-classes',
    (i) => i.text === 'Typical Difficulty Classes',
  ),
  // Document-wide tables (eshyra-4a7.3) whose emitted record name differs
  // from the source text, so the name auto-match cannot claim them. (The
  // Sorcerer-chapter "Draconic Ancestry" caption auto-matches the p5
  // `table:draconic-ancestry` record by name; its own 2-column copy is the
  // separate `table:draconic-bloodline-draconic-ancestry` record.)
  ...CIRCLE_OF_THE_LAND_TABLE_TERRAINS.map(([terrain, key]) =>
    recordRule(
      key,
      (i) =>
        i.section === 'Druid' &&
        i.structure === 'table-caption' &&
        i.text === terrain,
    ),
  ),
  ...CAPTIONLESS_MAGIC_ITEM_TABLE_RECORDS.map(([itemHeading, key]) =>
    recordRule(
      key,
      (i) => i.structure === 'table-shape' && i.context === itemHeading,
    ),
  ),
  // "<Race> Traits" subsection headings — traits are child data on the
  // ancestry records.
  ...RACE_TRAIT_HEADINGS.map(([heading, key]) =>
    childOfRule(key, (i) => i.section === 'Races' && i.text === heading),
  ),
  // Figurine of Wondrous Power is currently swallowed by Feather Token; the
  // magic-item boundary bead emits it as its own record.
  knownGapRule('eshyra-4a7.8', (i) => i.text === 'Figurine of Wondrous Power'),
  // Embedded stat blocks outside the monster chapters (Avatar of Death p218,
  // Giant Fly p222) — the document-wide stat-block bead accounts for them.
  knownGapRule('eshyra-4a7.4', (i) => i.structure === 'stat-block'),
  // Creature variant sidebars (Variant: Diseased Giant Rats p378, Variant:
  // Insect Swarms p391) — variant notes belong to the stat-block completion
  // bead ("variant notes where present").
  knownGapRule(
    'eshyra-4a7.5',
    (i) =>
      /^Variant: /.test(i.text) &&
      (i.section === 'Monsters' ||
        (i.section?.startsWith('Appendix MM') ?? false)),
  ),
  // Rules-chapter "Variant:" optional rules (Skills with Different Abilities
  // p78, Encumbrance p80) — documented intentional exclusion; see the
  // EXPECTED_SRD_5_1_RULE_KEYS baseline comment in index.ts.
  ignoreRule('variant-rule-excluded', (i) => /^Variant: /.test(i.text)),
  // Everything unmatched inside the 12 class chapters: progression-table
  // captions ("The Barbarian"), spell-slot table fragments, feature-option
  // headings (Fighting Styles, Eldritch Invocations, Metamagic, ki options,
  // Pact Boons, Domain/Oath/Circle spell lists, spellcasting boilerplate
  // leaves) — all owned by the class/subclass progression-and-options
  // modeling bead. Genuine drops of already-emitted class content stay
  // guarded by the rule/feature/subclass gates and the sourceCoverage.ts
  // name lists.
  knownGapRule(
    'eshyra-4a7.6',
    (i) => i.section !== null && CLASS_CHAPTER_SECTIONS.has(i.section),
  ),
  // Per-class spell-list headers (p105-113): pure list structure; the lists
  // themselves are represented as `data.classes` on every spell record.
  ignoreRule(
    'spell-list-header',
    (i) =>
      SPELL_LIST_LEVEL_HEADER.test(i.text) ||
      SPELL_LIST_CLASS_HEADER.test(i.text),
  ),
  // Gamemastering group headings whose children are all emitted hazard
  // records (the 8 sample traps, 3 diseases, 14 poisons).
  ignoreRule('record-group-heading', (i) =>
    ['Sample Traps', 'Sample Diseases', 'Sample Poisons'].includes(i.text),
  ),
  // "Statistics for Objects" (p203) is the body of the emitted rule:objects
  // record (its AC/HP tables are separate emitted table records).
  childOfRule('rule:objects', (i) => i.text === 'Statistics for Objects'),
  // The Poisons price/type reference table (p204): its rows land on the
  // poison hazard records as `poisonType` + `price` child data.
  ignoreRule(
    'table-rows-emitted-as-records',
    (i) => i.text === 'Poisons' && i.structure === 'table-caption',
  ),
  // Acolyte background child structures (p61): the feature heading is
  // `data.feature` and the caption-less suggested-characteristics run is
  // `data.suggestedCharacteristics` (also emitted as 4 table records).
  childOfRule(
    'background:acolyte',
    (i) =>
      i.text === 'Feature: Shelter of the Faithful' ||
      (i.structure === 'table-shape' &&
        i.context === 'Suggested Characteristics'),
  ),
  // Armor-weight category headings (p63): represented as `armorType` child
  // data on every armor equipment record.
  ignoreRule('equipment-category-heading', (i) =>
    ['Light Armor', 'Medium Armor', 'Heavy Armor'].includes(i.text),
  ),
  // Equipment reference tables whose rows ARE the equipment records, plus
  // the column fragments of those same physical tables that surface as
  // caption-less runs in the two-column layout.
  ignoreRule(
    'table-rows-emitted-as-records',
    (i) =>
      i.section === 'Equipment' &&
      (EQUIPMENT_ROWS_AS_RECORDS_CAPTIONS.has(i.text) ||
        i.structure === 'table-shape'),
  ),
  // Remaining Magic-Items-chapter embedded tables (eshyra-4a7.3 emitted the
  // representative set — Bags of Tricks, Giant Strength varieties, Potions of
  // Healing, Bag of Beans, Robe of Useful Items, Wand of Wonder, all claimed
  // above by auto-match or the caption-less record rules before this rule):
  // option/dice tables still flattened into their item descriptions
  // (Apparatus of the Crab Levers, Cube of Force Faces, Deck of
  // Illusions/Many Things cards, Dragon Scale Mail, Carpet of Flying, Feather
  // Token, Horn of Valhalla, Iron Flask, Manual of Golems, Necklace of Prayer
  // Beads, resistance tables, Staff retributive-strike tables, scroll-mishap
  // table) plus the four sentient-item property tables (p251-252). The
  // magic-item embedded-content bead owns their structured representation.
  knownGapRule(
    'eshyra-4a7.8',
    (i) =>
      i.section === 'Magic Items' &&
      (i.structure === 'table-caption' || i.structure === 'table-shape'),
  ),
  // Spell-embedded tables (Animated Object Statistics p116, Confusion d10
  // Behavior p127, Control Weather Precipitation/Temperature/Wind p131,
  // Creation Material Duration p132, Reincarnate d100 Race p174, Scrying
  // Knowledge/Save p176, Teleport familiarity matrix p186) — currently
  // flattened into spell descriptions; the follow-up bead emits them.
  knownGapRule(
    'eshyra-o4j7',
    (i) =>
      i.section === 'Spellcasting' &&
      (i.structure === 'table-caption' || i.structure === 'table-shape'),
  ),
  // Unimported prose regions, tracked region-by-region in eshyra-4a7.10.
  knownGapRule(
    'eshyra-4a7.10',
    (i) =>
      (i.section === 'Races' && RACES_INTRO_PROSE_HEADINGS.has(i.text)) ||
      (i.section === 'Equipment' && EQUIPMENT_PROSE_HEADINGS.has(i.text)) ||
      // The "Self-Sufficiency" downtime sidebar (p73): a prose callout box
      // whose body renders at table-cell height, so the inventory classifies
      // it as a table-caption; it belongs to the unimported-prose bead with
      // the rest of the Expenses region.
      (i.section === 'Equipment' && i.text === 'Self-Sufficiency') ||
      // Monsters-chapter creature-family lore headings (Angels … Zombies,
      // the ten per-color dragon group intros, Half-Dragon Template) plus the
      // two Half-Dragon Template tables (Color/Damage Resistance p320 and the
      // size/breath-weapon table p321), which belong to the same unimported
      // template region. Section-tier items there are the alphabetical
      // "Monsters (A)" … navigation headings — left to the
      // document-structure default.
      (i.section === 'Monsters' &&
        i.structure === 'heading' &&
        (i.tier === 'subsection' || i.tier === 'leaf')) ||
      (i.section === 'Monsters' &&
        i.structure === 'table-shape' &&
        i.context === 'Half-Dragon Template') ||
      (i.section === 'Magic Items' &&
        SENTIENT_MAGIC_ITEM_HEADINGS.has(i.text)) ||
      (i.section?.startsWith('Appendix PH-B') ?? false) ||
      (i.section?.startsWith('Appendix PH-C') ?? false) ||
      i.text === 'Customizing NPCs',
  ),
];
