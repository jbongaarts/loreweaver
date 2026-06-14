/**
 * Link spell-embedded table records back to their owning spells (eshyra-o4j7).
 *
 * Ownership is recorded on the internal TableExtraction, not the emitted table
 * record. This keeps table data generic while making every embedded spell table
 * fail closed if its owner or emitted table record is missing.
 */

import { SRD_5_1_SPELL_TABLE_OWNERS } from '../../../src/rules/srdAudit.js';
import type { RulesRecord } from '../../../src/rules/types.js';
import type { TableExtraction } from './types.js';

export class SpellTableLinkError extends Error {
  override readonly name = 'SpellTableLinkError';
}

function sourceLabelFor(page: number): string {
  return `SRD 5.1 p. ${page}`;
}

function tableRecordFor(
  table: TableExtraction,
  tableRecords: readonly RulesRecord[],
): RulesRecord {
  const matches = tableRecords.filter(
    (record) =>
      record.kind === 'table' &&
      record.name === table.name &&
      record.source === sourceLabelFor(table.sourcePage),
  );
  if (matches.length !== 1) {
    throw new SpellTableLinkError(
      `embedded table "${table.name}" on page ${table.sourcePage} resolved to ${matches.length} emitted table records`,
    );
  }
  return matches[0];
}

/**
 * Add sorted `data.tableRefs` arrays to spells that own emitted tables.
 *
 * Invariants:
 * - every emitted spell-owned table resolves to exactly one table record;
 * - every such table has exactly one existing spell owner;
 * - every spell tableRef points to an emitted table record.
 */
export function linkSpellEmbeddedTables(input: {
  readonly spellRecords: readonly RulesRecord[];
  readonly tableRecords: readonly RulesRecord[];
  readonly tables: readonly TableExtraction[];
}): RulesRecord[] {
  const spellsByKey = new Map(
    input.spellRecords.map((record) => [record.key, record]),
  );
  const tableKeys = new Set(input.tableRecords.map((record) => record.key));
  const refsBySpell = new Map<string, Set<string>>();
  const ownerByTable = new Map<string, string>();

  for (const table of input.tables) {
    const ownerKey = table.ownerRecordKey;
    if (ownerKey === undefined || !ownerKey.startsWith('spell:')) continue;
    const owner = spellsByKey.get(ownerKey);
    if (owner === undefined || owner.kind !== 'spell') {
      throw new SpellTableLinkError(
        `embedded table "${table.name}" names missing spell owner ${ownerKey}`,
      );
    }
    const tableRecord = tableRecordFor(table, input.tableRecords);
    const expectedOwner = SRD_5_1_SPELL_TABLE_OWNERS[tableRecord.key];
    if (expectedOwner === undefined) {
      throw new SpellTableLinkError(
        `${tableRecord.key} is emitted as a spell-owned table but has no reviewed owner mapping`,
      );
    }
    if (expectedOwner !== ownerKey) {
      throw new SpellTableLinkError(
        `${tableRecord.key} extraction owner ${ownerKey} disagrees with reviewed owner ${expectedOwner}`,
      );
    }
    const priorOwner = ownerByTable.get(tableRecord.key);
    if (priorOwner !== undefined && priorOwner !== ownerKey) {
      throw new SpellTableLinkError(
        `${tableRecord.key} is owned by both ${priorOwner} and ${ownerKey}`,
      );
    }
    ownerByTable.set(tableRecord.key, ownerKey);
    const refs = refsBySpell.get(ownerKey) ?? new Set<string>();
    refs.add(tableRecord.key);
    refsBySpell.set(ownerKey, refs);
  }

  const linked = input.spellRecords.map((record) => {
    const refs = refsBySpell.get(record.key);
    if (refs === undefined) return record;
    return {
      ...record,
      data: {
        ...(record.data as Record<string, unknown>),
        tableRefs: [...refs].sort(),
      },
    };
  });

  for (const record of linked) {
    const refs = (record.data as { tableRefs?: unknown }).tableRefs;
    if (!Array.isArray(refs)) continue;
    for (const ref of refs) {
      if (typeof ref !== 'string' || !tableKeys.has(ref)) {
        throw new SpellTableLinkError(
          `${record.key} has tableRef to missing table ${String(ref)}`,
        );
      }
    }
  }

  return linked;
}
