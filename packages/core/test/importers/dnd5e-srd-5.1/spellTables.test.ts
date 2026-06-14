import { describe, expect, it } from 'vitest';
import {
  linkSpellEmbeddedTables,
  SpellTableLinkError,
} from '../../../scripts/importers/dnd5e-srd-5.1/spellTables.js';
import type { TableExtraction } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';
import type { RulesRecord } from '../../../src/rules/types.js';

function record(input: {
  readonly kind: string;
  readonly key: string;
  readonly name: string;
  readonly source: string;
  readonly data?: Record<string, unknown>;
}): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    data: {},
    license: {} as RulesRecord['license'],
    provenance: {} as RulesRecord['provenance'],
    ...input,
  } as RulesRecord;
}

function spell(key: string, name: string): RulesRecord {
  return record({
    kind: 'spell',
    key,
    name,
    source: 'SRD 5.1 p. 131',
    data: { description: 'Source-preserving spell prose.' },
  });
}

function weatherTable(
  name: string,
  key: string,
): {
  readonly extraction: TableExtraction;
  readonly record: RulesRecord;
} {
  return {
    extraction: {
      name,
      columns: ['Stage', 'Condition'],
      rows: [[1, 'Clear']],
      sourcePage: 131,
      ownerRecordKey: 'spell:control-weather',
    },
    record: record({
      kind: 'table',
      key,
      name,
      source: 'SRD 5.1 p. 131',
      data: { columns: ['Stage', 'Condition'], rows: [[1, 'Clear']] },
    }),
  };
}

describe('linkSpellEmbeddedTables', () => {
  const precipitation = weatherTable('Precipitation', 'table:precipitation');
  const temperature = weatherTable('Temperature', 'table:temperature');
  const wind = weatherTable('Wind', 'table:wind');

  it('links all emitted weather tables to Control Weather in sorted key order', () => {
    const [linked] = linkSpellEmbeddedTables({
      spellRecords: [spell('spell:control-weather', 'Control Weather')],
      tableRecords: [precipitation.record, temperature.record, wind.record],
      tables: [
        precipitation.extraction,
        temperature.extraction,
        wind.extraction,
      ],
    });
    expect(linked.data).toEqual({
      description: 'Source-preserving spell prose.',
      tableRefs: ['table:precipitation', 'table:temperature', 'table:wind'],
    });
  });

  it('fails when an emitted spell table has no owning spell record', () => {
    expect(() =>
      linkSpellEmbeddedTables({
        spellRecords: [],
        tableRecords: [wind.record],
        tables: [wind.extraction],
      }),
    ).toThrow(SpellTableLinkError);
    expect(() =>
      linkSpellEmbeddedTables({
        spellRecords: [],
        tableRecords: [wind.record],
        tables: [wind.extraction],
      }),
    ).toThrow(/missing spell owner spell:control-weather/);
  });

  it('fails when an extraction cannot resolve its emitted table record', () => {
    expect(() =>
      linkSpellEmbeddedTables({
        spellRecords: [spell('spell:control-weather', 'Control Weather')],
        tableRecords: [],
        tables: [wind.extraction],
      }),
    ).toThrow(/resolved to 0 emitted table records/);
  });

  it('fails when a newly emitted spell-owned table lacks a reviewed mapping', () => {
    const extraction: TableExtraction = {
      name: 'Future Spell Table',
      columns: ['d6', 'Result'],
      rows: [[1, 'Result']],
      sourcePage: 150,
      ownerRecordKey: 'spell:fireball',
    };
    const table = record({
      kind: 'table',
      key: 'table:future-spell-table',
      name: extraction.name,
      source: 'SRD 5.1 p. 150',
      data: { columns: extraction.columns, rows: extraction.rows },
    });
    expect(() =>
      linkSpellEmbeddedTables({
        spellRecords: [spell('spell:fireball', 'Fireball')],
        tableRecords: [table],
        tables: [extraction],
      }),
    ).toThrow(/has no reviewed owner mapping/);
  });

  it('leaves reduced fixtures without spell-owned tables unchanged', () => {
    const source = [spell('spell:fireball', 'Fireball')];
    expect(
      linkSpellEmbeddedTables({
        spellRecords: source,
        tableRecords: [],
        tables: [],
      }),
    ).toEqual(source);
  });
});
