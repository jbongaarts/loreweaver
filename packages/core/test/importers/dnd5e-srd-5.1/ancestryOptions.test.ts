/**
 * Unit tests for the ancestry option-table linker (eshyra-4a7.7).
 *
 * `linkAncestryOptionTables` adds a per-trait `tableRefs` link on any ancestry
 * trait whose prose names "the <Name> table" when a `table` record with that
 * name exists on the same SRD page. The Dragonborn Draconic Ancestry trait is
 * the only SRD 5.1 races-chapter case; the page match disambiguates it from the
 * identically-named Sorcerer "Draconic Bloodline" table on p. 44.
 */

import { describe, expect, it } from 'vitest';
import { linkAncestryOptionTables } from '../../../scripts/importers/dnd5e-srd-5.1/ancestryOptions.js';
import type { RulesRecord } from '../../../src/rules/types.js';

// Minimal record builder — the linker reads only kind/key/name/source/data.
function rec(partial: {
  kind: string;
  key: string;
  name: string;
  source: string;
  data?: Record<string, unknown>;
}): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    data: {},
    license: {} as RulesRecord['license'],
    provenance: {} as RulesRecord['provenance'],
    ...partial,
  } as RulesRecord;
}

const dragonborn = (): RulesRecord =>
  rec({
    kind: 'ancestry',
    key: 'ancestry:dragonborn',
    name: 'Dragonborn',
    source: 'SRD 5.1 p. 5',
    data: {
      traits: [
        { name: 'Speed', text: 'Your base walking speed is 30 feet.' },
        {
          name: 'Draconic Ancestry',
          text: 'You have draconic ancestry. Choose one type of dragon from the Draconic Ancestry table. Your breath weapon and damage resistance are determined by the dragon type, as shown in the table.',
        },
      ],
    },
  });

const racesDraconicTable = (): RulesRecord =>
  rec({
    kind: 'table',
    key: 'table:draconic-ancestry',
    name: 'Draconic Ancestry',
    source: 'SRD 5.1 p. 5',
    data: { columns: ['Dragon'], rows: [['Black']] },
  });

const sorcererDraconicTable = (): RulesRecord =>
  rec({
    kind: 'table',
    key: 'table:draconic-bloodline-draconic-ancestry',
    name: 'Draconic Ancestry',
    source: 'SRD 5.1 p. 44',
    data: { columns: ['Dragon'], rows: [['Black']] },
  });

function traitsOf(record: RulesRecord): ReadonlyArray<{
  name: string;
  text: string;
  tableRefs?: readonly string[];
}> {
  return (
    record.data as {
      traits: ReadonlyArray<{
        name: string;
        text: string;
        tableRefs?: readonly string[];
      }>;
    }
  ).traits;
}

describe('linkAncestryOptionTables', () => {
  it('links a trait that names "the <Name> table" to the same-page table', () => {
    const [linked] = linkAncestryOptionTables(
      [dragonborn()],
      [racesDraconicTable()],
    );
    const trait = traitsOf(linked).find((t) => t.name === 'Draconic Ancestry');
    expect(trait?.tableRefs).toEqual(['table:draconic-ancestry']);
  });

  it('preserves trait field order as { name, text, tableRefs }', () => {
    const [linked] = linkAncestryOptionTables(
      [dragonborn()],
      [racesDraconicTable()],
    );
    const trait = traitsOf(linked).find((t) => t.name === 'Draconic Ancestry');
    expect(Object.keys(trait as object)).toEqual(['name', 'text', 'tableRefs']);
  });

  it('disambiguates identically-named tables by source page', () => {
    // The Sorcerer "Draconic Ancestry" table is on p. 44; the Dragonborn trait
    // is on p. 5, so only the p. 5 table is linked.
    const [linked] = linkAncestryOptionTables(
      [dragonborn()],
      [racesDraconicTable(), sorcererDraconicTable()],
    );
    const trait = traitsOf(linked).find((t) => t.name === 'Draconic Ancestry');
    expect(trait?.tableRefs).toEqual(['table:draconic-ancestry']);
  });

  it('does not link when no matching table exists on the trait page', () => {
    const [linked] = linkAncestryOptionTables(
      [dragonborn()],
      [sorcererDraconicTable()],
    );
    const trait = traitsOf(linked).find((t) => t.name === 'Draconic Ancestry');
    expect(trait?.tableRefs).toBeUndefined();
  });

  it('leaves traits without a table reference unchanged', () => {
    const [linked] = linkAncestryOptionTables(
      [dragonborn()],
      [racesDraconicTable()],
    );
    const speed = traitsOf(linked).find((t) => t.name === 'Speed');
    expect(speed).toEqual({
      name: 'Speed',
      text: 'Your base walking speed is 30 feet.',
    });
  });

  it('returns ancestry records without traits unchanged', () => {
    const noTraits = rec({
      kind: 'ancestry',
      key: 'ancestry:human',
      name: 'Human',
      source: 'SRD 5.1 p. 5',
      data: { description: 'Humans.' },
    });
    const [out] = linkAncestryOptionTables([noTraits], [racesDraconicTable()]);
    expect(out).toBe(noTraits);
  });
});
