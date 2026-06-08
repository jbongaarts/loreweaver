/**
 * SOURCE-coverage expectations for the D&D 5e SRD 5.1 audit.
 *
 * The importer's `EXPECTED_SRD_5_1_*` constants describe what the importer
 * currently EMITS — they are the baseline its own output is gated against. That
 * makes them the wrong input for the audit's `missing-coverage` check: a record
 * the importer does not yet parse is, by construction, absent from `EXPECTED_*`
 * too, so a coverage check keyed on `EXPECTED_*` can never notice the gap. The
 * 2026-06-07 manual SRD audit hit exactly this — the Orb of Dragonkind magic
 * item is missing from the committed pack AND from
 * `EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES`.
 *
 * This module is the SOURCE layer: what the SRD 5.1 source actually contains,
 * independent of what the importer emits today. Each list is the importer's
 * emitted baseline PLUS a curated set of records confirmed present in the source
 * but not yet emitted (the "known source gaps"). The audit keys its coverage
 * check on these lists, so a known-missing source record is reported as a
 * `missing-coverage` finding until the importer closes the gap.
 *
 * Lifecycle: when an importer fix bead (e.g. eshyra-0m9.16 for Orb of
 * Dragonkind) adds a gap record to the emitted `EXPECTED_*` list, the entry
 * appears in both inputs. `dedupe` keeps the source list stable, so a closed gap
 * can stay listed in the gap arrays below without producing a duplicate or a
 * false finding — the audit simply stops reporting it once the pack contains it.
 *
 * This file intentionally does NOT fix the importer; per eshyra-0m9.24 its job
 * is to make the audit *catch* the omission. The actual import of Orb of
 * Dragonkind belongs to eshyra-0m9.16.
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
 * SRD 5.1 magic items confirmed present in the source but not (yet) emitted by
 * the importer. Tracked here so the audit reports them as missing until the
 * importer catches up. See eshyra-0m9.16 (Orb of Dragonkind).
 */
export const SRD_5_1_SOURCE_MAGIC_ITEM_GAPS: readonly string[] = [
  'Orb of Dragonkind',
];

/** SRD 5.1 rule sections present in the source but not yet emitted. */
export const SRD_5_1_SOURCE_RULE_KEY_GAPS: readonly string[] = [];

/** SRD 5.1 tables present in the source but not yet emitted. */
export const SRD_5_1_SOURCE_TABLE_GAPS: readonly string[] = [];

/**
 * Source-coverage magic-item name set: every magic item the SRD 5.1 source
 * contains. Used by the audit's `missing-coverage` check so a known omission
 * (Orb of Dragonkind) is caught even though it is absent from the importer's
 * emitted `EXPECTED_SRD_5_1_MAGIC_ITEM_NAMES`.
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
