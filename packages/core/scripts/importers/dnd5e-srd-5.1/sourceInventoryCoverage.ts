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
      return { item, status: { kind: 'ignored', reason: 'document-structure' } };
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
      const section = item.section === null ? '' : ` (section: ${item.section})`;
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
