/**
 * SOURCE-coverage expectations for the D&D 5e SRD 5.1 audit.
 *
 * The importer's `EXPECTED_SRD_5_1_*` constants describe what the importer
 * currently EMITS — they are the baseline its own output is gated against. That
 * makes them the wrong input for the audit's `missing-coverage` check: a record
 * the importer does not yet parse is, by construction, absent from `EXPECTED_*`
 * too, so a coverage check keyed on `EXPECTED_*` can never notice the gap. The
 * 2026-06-07 manual SRD audit hit exactly this — at the time, the Orb of
 * Dragonkind magic item was missing from the committed pack AND from
 * `EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES` (it has since been emitted; see below).
 *
 * This module is the SOURCE layer: what the SRD 5.1 source actually contains,
 * independent of what the importer emits today. Each list is the importer's
 * emitted baseline PLUS a curated set of records confirmed present in the source
 * (the "known source gaps"). The audit keys its coverage check on these lists,
 * so a source record missing from the pack is reported as a `missing-coverage`
 * finding — whether it has never been emitted yet, or it regressed out of a pack
 * that used to contain it.
 *
 * Lifecycle: when an importer fix bead adds a gap record to the emitted
 * `EXPECTED_*` list, the entry appears in both inputs. `dedupe` keeps the source
 * list stable, so a closed gap stays listed in the gap arrays below without
 * producing a duplicate or a false finding — the audit simply stops reporting it
 * once the pack contains it, and keeps catching it if it ever regresses out.
 * Orb of Dragonkind is the worked example: eshyra-0m9.24 added it as a source
 * gap (audit-only), and eshyra-0m9.16 made the importer emit it (Artifacts
 * subsection). Its gap entry is intentionally retained as durable source truth.
 */

import {
  EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES,
  EXPECTED_SRD_5_1_RULE_KEYS,
  EXPECTED_SRD_5_1_TABLE_NAMES,
} from './index.js';

function dedupe(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

/**
 * SRD 5.1 magic items confirmed present in the source. Entries are tracked here
 * so the audit reports them as missing if they are absent from the pack —
 * whether never-yet-emitted or regressed out. Orb of Dragonkind is now emitted
 * (eshyra-0m9.16, from the Artifacts subsection) but is retained as durable
 * source truth so a regression that dropped it is still caught.
 */
export const SRD_5_1_SOURCE_MAGIC_ITEM_GAPS: readonly string[] = [
  'Figurine of Wondrous Power',
  'Orb of Dragonkind',
];

/** SRD 5.1 rule sections present in the source but not yet emitted. */
export const SRD_5_1_SOURCE_RULE_KEY_GAPS: readonly string[] = [];

/**
 * SRD 5.1 tables tracked as durable SOURCE truth. The audit reports each as
 * `missing-coverage` if it is absent from the pack — whether never-yet-emitted
 * or regressed out — which is the "make new omissions visible" mechanism from
 * eshyra-0m9.23.
 *
 * Lifecycle (same as the Orb of Dragonkind magic-item gap): an entry is added
 * here when the source table is confirmed present but unemitted, and is RETAINED
 * after the importer learns to emit it so a future regression that drops it is
 * still caught. The five money / downtime tables below were added by
 * eshyra-0m9.23 (audit-only) and are now emitted by eshyra-0m9.19 — Standard
 * Exchange Rates / Trade Goods / Lifestyle Expenses as clean reference tables,
 * and Food/Drink/Lodging / Services as grouped tables whose sub-items fold into
 * qualified item names. They stay listed as durable source truth, so `dedupe`
 * keeps the SOURCE list a stable superset of the emitted baseline and the audit
 * simply stops reporting them now that the pack contains them.
 */
export const SRD_5_1_SOURCE_TABLE_GAPS: readonly string[] = [
  'Standard Exchange Rates',
  'Trade Goods',
  'Lifestyle Expenses',
  'Food, Drink, and Lodging',
  'Services',
  // The 24 document-wide tables emitted by eshyra-4a7.3 (parseDocumentTables),
  // retained here as durable source truth on the same lifecycle: the audit
  // reports any of them as missing-coverage if a regression drops them from
  // the emitted baseline. Names follow the emitted records (verbatim captions;
  // synthesized names for the caption-less tables — see
  // EXPECTED_SRD_5_1_TABLE_NAMES in index.ts).
  'Bag of Beans',
  'Belt of Giant Strength',
  'Circle of the Land (Arctic)',
  'Circle of the Land (Coast)',
  'Circle of the Land (Desert)',
  'Circle of the Land (Forest)',
  'Circle of the Land (Grassland)',
  'Circle of the Land (Mountain)',
  'Circle of the Land (Swamp)',
  'Creating Spell Slots',
  'Donning and Doffing Armor',
  'Draconic Ancestry',
  'Draconic Bloodline Draconic Ancestry',
  'Fiend Expanded Spells',
  'Gray Bag of Tricks',
  'Life Domain Spells',
  'Oath of Devotion Spells',
  'Potion of Giant Strength',
  'Potions of Healing',
  'Robe of Useful Items',
  'Rust Bag of Tricks',
  'Tan Bag of Tricks',
  'The Barbarian',
  'Wand of Wonder',
  'Apparatus of the Crab Levers',
  'Armor of Resistance',
  'Candle of Invocation',
  'Carpet of Flying',
  'Cube of Force Charges Lost',
  'Cube of Force Faces',
  'Deck of Illusions',
  'Deck of Many Things',
  'Dragon Scale Mail',
  'Efreeti Bottle',
  'Elemental Gem',
  'Feather Token',
  'Horn of Valhalla',
  'Iron Flask',
  'Manual of Golems',
  'Necklace of Prayer Beads',
  'Potion of Resistance',
  'Ring of Resistance',
  'Ring of Shooting Stars',
  'Sentient Magic Item Alignment',
  'Sentient Magic Item Communication',
  'Sentient Magic Item Senses',
  'Sentient Magic Item Special Purpose',
  'Spell Scroll',
  'Sphere of Annihilation',
  'Staff of Power',
  'Staff of the Magi',
];

/**
 * Source-coverage magic-item name set: every magic item the SRD 5.1 source
 * contains. Used by the audit's `missing-coverage` check so any source item
 * missing from the pack is caught. With Orb of Dragonkind now emitted
 * (eshyra-0m9.16) this set equals the emitted `EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES`
 * after dedupe, but it stays a distinct SOURCE layer so a future regression that
 * drops a source item from `EXPECTED_*` is still flagged.
 */
export const SOURCE_EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES: readonly string[] =
  dedupe([
    ...EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES,
    ...SRD_5_1_SOURCE_MAGIC_ITEM_GAPS,
  ]);

/** Source-coverage rule-key set (emitted baseline plus known source gaps). */
export const SOURCE_EXPECTED_SRD_5_1_RULE_KEYS: readonly string[] = dedupe([
  ...EXPECTED_SRD_5_1_RULE_KEYS,
  ...SRD_5_1_SOURCE_RULE_KEY_GAPS,
]);

/** Source-coverage table-name set (emitted baseline plus known source gaps). */
export const SOURCE_EXPECTED_SRD_5_1_TABLE_NAMES: readonly string[] = dedupe([
  ...EXPECTED_SRD_5_1_TABLE_NAMES,
  ...SRD_5_1_SOURCE_TABLE_GAPS,
]);
