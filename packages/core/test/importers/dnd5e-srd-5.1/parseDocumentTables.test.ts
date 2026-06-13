/**
 * Unit tests for the document-wide table parser (eshyra-4a7.3).
 *
 * `parseDocumentTables` locates each reviewed table spec by typography — a
 * leaf-tier (h≈12) anchor heading plus the table's exact cell-tier (h≈8.9)
 * column-header line(s) — and reconstructs rows from the contiguous cell-tier
 * run. These tests build synthetic tiered fixtures shaped like the real
 * SRD 5.1 extraction (see the eshyra-4a7.1 tier map) and pin:
 *
 *   - one representative table per row rule (line-per-row, wrapped last
 *     column, the Barbarian wrapped-Features shape, wrapped d100 rows);
 *   - the disambiguation of the two same-caption "Draconic Ancestry" tables;
 *   - cross-page cell runs (Bag of Beans);
 *   - fail-closed behavior: row-count drift, header drift, prose sidebars at
 *     cell height, and uniform-font fixtures all yield NO table rather than a
 *     partial or wrong one.
 */

import { describe, expect, it } from 'vitest';
import {
  parseDocumentTables,
  SRD_5_1_DOCUMENT_TABLE_SPECS,
} from '../../../scripts/importers/dnd5e-srd-5.1/parseDocumentTables.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

const LEAF = 12.0;
const CELL = 8.9;
const BODY = 9.8;
const SIDEBAR = 10.8;

function tieredPage(
  pageNumber: number,
  entries: readonly (readonly [line: string, height: number])[],
): PageText {
  return {
    pageNumber,
    lines: entries.map(([line]) => line),
    lineHeights: entries.map(([, height]) => height),
  };
}

function byName(pages: readonly PageText[]) {
  return new Map(parseDocumentTables(pages).map((t) => [t.name, t]));
}

// ---------------------------------------------------------------------------
// line-per-row + same-caption disambiguation: the two Draconic Ancestry tables
// ---------------------------------------------------------------------------

const DRACONIC_ROWS: readonly (readonly [string, string, string])[] = [
  ['Black', 'Acid', '5 by 30 ft. line (Dex. save)'],
  ['Blue', 'Lightning', '5 by 30 ft. line (Dex. save)'],
  ['Brass', 'Fire', '5 by 30 ft. line (Dex. save)'],
  ['Bronze', 'Lightning', '5 by 30 ft. line (Dex. save)'],
  ['Copper', 'Acid', '5 by 30 ft. line (Dex. save)'],
  ['Gold', 'Fire', '15 ft. cone (Dex. save)'],
  ['Green', 'Poison', '15 ft. cone (Con. save)'],
  ['Red', 'Fire', '15 ft. cone (Dex. save)'],
  ['Silver', 'Cold', '15 ft. cone (Con. save)'],
  ['White', 'Cold', '15 ft. cone (Con. save)'],
];

function draconicRacesPage(): PageText {
  return tieredPage(5, [
    ['Speed. Your base walking speed is 30 feet.', BODY],
    ['Draconic Ancestry', LEAF],
    ['Dragon Damage Type Breath Weapon', CELL],
    ...DRACONIC_ROWS.map((row): readonly [string, number] => [
      row.join(' '),
      CELL,
    ]),
    ['Draconic Ancestry. You have draconic ancestry.', BODY],
  ]);
}

function draconicSorcererPage(): PageText {
  return tieredPage(44, [
    ['dragon is used by features you gain later.', BODY],
    ['Draconic Ancestry', LEAF],
    ['Dragon Damage Type', CELL],
    ...DRACONIC_ROWS.map((row): readonly [string, number] => [
      `${row[0]} ${row[1]}`,
      CELL,
    ]),
    ['Dragon Wings', LEAF],
  ]);
}

describe('parseDocumentTables — Draconic Ancestry (line-per-row, shared caption)', () => {
  it('reconstructs the 3-column Races table with row order and verbatim cells', () => {
    const tables = byName([draconicRacesPage()]);
    const table = tables.get('Draconic Ancestry');
    expect(table).toBeDefined();
    expect(table?.columns).toEqual(['Dragon', 'Damage Type', 'Breath Weapon']);
    expect(table?.rows).toEqual(DRACONIC_ROWS.map((row) => [...row]));
    expect(table?.sourcePage).toBe(5);
  });

  it('disambiguates the Sorcerer copy by its 2-column header line', () => {
    const tables = byName([draconicRacesPage(), draconicSorcererPage()]);
    expect(tables.get('Draconic Ancestry')?.sourcePage).toBe(5);
    const bloodline = tables.get('Draconic Bloodline Draconic Ancestry');
    expect(bloodline).toBeDefined();
    expect(bloodline?.columns).toEqual(['Dragon', 'Damage Type']);
    expect(bloodline?.rows).toEqual(
      DRACONIC_ROWS.map((row) => [row[0], row[1]]),
    );
    expect(bloodline?.sourcePage).toBe(44);
  });

  it('emits neither table when a fixture renders uniform font heights', () => {
    const uniform = tieredPage(5, [
      ['Draconic Ancestry', BODY],
      ['Dragon Damage Type Breath Weapon', BODY],
      ...DRACONIC_ROWS.map((row): readonly [string, number] => [
        row.join(' '),
        BODY,
      ]),
    ]);
    expect(parseDocumentTables([uniform])).toEqual([]);
  });

  it('fails the table closed when a row goes missing (count drift)', () => {
    const short = tieredPage(5, [
      ['Draconic Ancestry', LEAF],
      ['Dragon Damage Type Breath Weapon', CELL],
      ...DRACONIC_ROWS.slice(0, 9).map((row): readonly [string, number] => [
        row.join(' '),
        CELL,
      ]),
      ['Draconic Ancestry. You have draconic ancestry.', BODY],
    ]);
    expect(byName([short]).get('Draconic Ancestry')).toBeUndefined();
  });

  it('fails the table closed when the header line drifts', () => {
    const drifted = tieredPage(5, [
      ['Draconic Ancestry', LEAF],
      ['Dragon Damage Kind Breath Weapon', CELL],
      ...DRACONIC_ROWS.map((row): readonly [string, number] => [
        row.join(' '),
        CELL,
      ]),
    ]);
    expect(byName([drifted]).get('Draconic Ancestry')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// wrapped last column: subclass spell tables (Oath of Devotion + a circle)
// ---------------------------------------------------------------------------

describe('parseDocumentTables — level/spells tables (wrapped last column)', () => {
  it('reconstructs Oath of Devotion Spells behind its two header lines', () => {
    const page = tieredPage(33, [
      ['You gain oath spells at the paladin levels listed.', BODY],
      ['Oath of Devotion Spells', LEAF],
      ['Paladin', CELL],
      ['Level Spells', CELL],
      ['3rd protection from evil and good, sanctuary', CELL],
      ['5th lesser restoration, zone of truth', CELL],
      ['9th beacon of hope, dispel magic', CELL],
      ['13th freedom of movement, guardian of faith', CELL],
      ['17th commune, flame strike', CELL],
      ['Channel Divinity', LEAF],
    ]);
    const table = byName([page]).get('Oath of Devotion Spells');
    expect(table).toBeDefined();
    expect(table?.columns).toEqual(['Paladin Level', 'Spells']);
    expect(table?.rows).toEqual([
      ['3rd', 'protection from evil and good, sanctuary'],
      ['5th', 'lesser restoration, zone of truth'],
      ['9th', 'beacon of hope, dispel magic'],
      ['13th', 'freedom of movement, guardian of faith'],
      ['17th', 'commune, flame strike'],
    ]);
  });

  it('re-joins a wrapped spells cell (the Desert circle "protection from / energy" wrap)', () => {
    const page = tieredPage(22, [
      ['Desert', LEAF],
      ['Druid Level Circle Spells', CELL],
      ['3rd blur, silence', CELL],
      ['5th create food and water, protection from', CELL],
      ['energy', CELL],
      ['7th blight, hallucinatory terrain', CELL],
      ['9th insect plague, wall of stone', CELL],
      ['Forest', LEAF],
    ]);
    const table = byName([page]).get('Circle of the Land (Desert)');
    expect(table).toBeDefined();
    expect(table?.rows).toEqual([
      ['3rd', 'blur, silence'],
      ['5th', 'create food and water, protection from energy'],
      ['7th', 'blight, hallucinatory terrain'],
      ['9th', 'insect plague, wall of stone'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// The Barbarian progression: wrapped Features column
// ---------------------------------------------------------------------------

describe('parseDocumentTables — The Barbarian (wrapped Features column)', () => {
  it('re-joins wrapped Features cells and keeps the Unlimited rages cell verbatim', () => {
    const rows: (readonly [string, number])[] = [
      ['1st +2 Rage, 2 +2', CELL],
      ['Unarmored', CELL],
      ['Defense', CELL],
      ['2nd +2 Reckless 2 +2', CELL],
      ['Attack,', CELL],
      ['Danger Sense', CELL],
      ['3rd +2 Primal Path 3 +2', CELL],
      ['4th +2 Ability Score 3 +2', CELL],
      ['Improvement', CELL],
      ['5th +3 Extra Attack, 3 +2', CELL],
      ['Fast', CELL],
      ['Movement', CELL],
      ['6th +3 Path feature 4 +2', CELL],
      ['7th +3 Feral Instinct 4 +2', CELL],
      ['8th +3 Ability Score 4 +2', CELL],
      ['Improvement', CELL],
      ['9th +4 Brutal Critical 4 +3', CELL],
      ['(1 die)', CELL],
      ['10th +4 Path feature 4 +3', CELL],
      ['11th +4 Relentless 4 +3', CELL],
      ['Rage', CELL],
      ['12th +4 Ability Score 5 +3', CELL],
      ['Improvement', CELL],
      ['13th +5 Brutal Critical 5 +3', CELL],
      ['(2 dice)', CELL],
      ['14th +5 Path feature 5 +3', CELL],
      ['15th +5 Persistent 5 +3', CELL],
      ['Rage', CELL],
      ['16th +5 Ability Score 5 +4', CELL],
      ['Improvement', CELL],
      ['17th +6 Brutal Critical 6 +4', CELL],
      ['(3 dice)', CELL],
      ['18th +6 Indomitable 6 +4', CELL],
      ['Might', CELL],
      ['19th +6 Ability Score 6 +4', CELL],
      ['Improvement', CELL],
      ['20th +6 Primal Unlimited +4', CELL],
      ['Champion', CELL],
    ];
    const page = tieredPage(8, [
      ['The Barbarian', LEAF],
      ['Proficiency Rage', CELL],
      ['Level Bonus Features Rages Damage', CELL],
      ...rows,
      ['Rage', 13.9],
      ['In battle, you fight with primal ferocity.', BODY],
    ]);
    const table = byName([page]).get('The Barbarian');
    expect(table).toBeDefined();
    expect(table?.columns).toEqual([
      'Level',
      'Proficiency Bonus',
      'Features',
      'Rages',
      'Rage Damage',
    ]);
    expect(table?.rows).toHaveLength(20);
    expect(table?.rows[0]).toEqual([
      '1st',
      '+2',
      'Rage, Unarmored Defense',
      '2',
      '+2',
    ]);
    expect(table?.rows[4]).toEqual([
      '5th',
      '+3',
      'Extra Attack, Fast Movement',
      '3',
      '+2',
    ]);
    expect(table?.rows[19]).toEqual([
      '20th',
      '+6',
      'Primal Champion',
      'Unlimited',
      '+4',
    ]);
  });
});

// ---------------------------------------------------------------------------
// wrapped d100 rows + item anchor + cross-page run: Bag of Beans
// ---------------------------------------------------------------------------

describe('parseDocumentTables — wrapped d100 tables (item-anchored)', () => {
  function bagOfBeansPages(): PageText[] {
    return [
      tieredPage(209, [
        ['Bag of Beans', LEAF],
        ['Wondrous item, rare', BODY],
        ['Inside this heavy cloth bag are 3d4 dry beans.', BODY],
        ['d100 Effect', CELL],
        ['01 5d4 toadstools sprout. If a creature eats a', CELL],
        ['toadstool, roll any die.', CELL],
        ['02–10 A geyser erupts and spouts water, beer, berry', CELL],
        ['juice, tea, vinegar, wine, or oil (GM’s choice) 30', CELL],
        ['feet into the air for 1d12 rounds.', CELL],
        ['11–20 A treant sprouts.', CELL],
        ['21–30 An animate, immobile stone statue rises.', CELL],
        ['31–40 A campfire with blue flames springs forth.', CELL],
        ['41–50 1d6 + 6 shriekers sprout', CELL],
        ['51–60 1d4 + 8 bright pink toads crawl forth.', CELL],
        ['61–70 A hungry bulette burrows up and attacks.', CELL],
        ['71–80 A fruit tree grows. It has 1d10 + 20 fruit, 1d8 of', CELL],
        ['which act as randomly determined magic', CELL],
        ['potions.', CELL],
        ['81–90 A nest of 1d4 + 3 eggs springs up. Any creature', CELL],
      ]),
      tieredPage(210, [
        ['that eats an egg must make a DC 20 Constitution', CELL],
        ['saving throw.', CELL],
        ['91–99 A pyramid with a 60-foot-square base bursts', CELL],
        ['upward.', CELL],
        ['00 A giant beanstalk sprouts, growing to a height of', CELL],
        ['the GM’s choice.', CELL],
        ['Bag of Devouring', LEAF],
        ['Wondrous item, very rare', BODY],
      ]),
    ];
  }

  it('anchors on the owning item heading and walks the run across the page break', () => {
    const table = byName(bagOfBeansPages()).get('Bag of Beans');
    expect(table).toBeDefined();
    expect(table?.columns).toEqual(['d100', 'Effect']);
    expect(table?.rows).toHaveLength(12);
    expect(table?.rows[0]).toEqual([
      '01',
      '5d4 toadstools sprout. If a creature eats a toadstool, roll any die.',
    ]);
    expect(table?.rows[1]).toEqual([
      '02–10',
      'A geyser erupts and spouts water, beer, berry juice, tea, vinegar, wine, or oil (GM’s choice) 30 feet into the air for 1d12 rounds.',
    ]);
    // The page break falls inside the 81–90 effect cell.
    expect(table?.rows[9]).toEqual([
      '81–90',
      'A nest of 1d4 + 3 eggs springs up. Any creature that eats an egg must make a DC 20 Constitution saving throw.',
    ]);
    expect(table?.rows[11]).toEqual([
      '00',
      'A giant beanstalk sprouts, growing to a height of the GM’s choice.',
    ]);
    expect(table?.sourcePage).toBe(209);
  });

  it('does not let a wrapped cell that begins with a bare number open a phantom row', () => {
    // "30 feet into the air" continues the 02–10 cell above; only zero-padded
    // singles ("01", "00") or ranges may start a row, so the row count stays
    // 12 and the cell text re-joins.
    const table = byName(bagOfBeansPages()).get('Bag of Beans');
    expect(table?.rows.map((row) => row[0])).toEqual([
      '01',
      '02–10',
      '11–20',
      '21–30',
      '31–40',
      '41–50',
      '51–60',
      '61–70',
      '71–80',
      '81–90',
      '91–99',
      '00',
    ]);
  });

  it('aborts an item-anchored scan at the next heading (no table claimed across entries)', () => {
    // A Bag of Beans entry with NO embedded table, directly followed by
    // another item whose body does carry a d100 run: the spec must not claim
    // the neighbor's table.
    const pages = [
      tieredPage(209, [
        ['Bag of Beans', LEAF],
        ['Wondrous item, rare', BODY],
        ['Inside this heavy cloth bag are 3d4 dry beans.', BODY],
        ['Bead of Force', LEAF],
        ['Wondrous item, rare', BODY],
        ['d100 Effect', CELL],
        ['01 Something happens.', CELL],
        ['02–00 Nothing happens.', CELL],
      ]),
    ];
    expect(byName(pages).get('Bag of Beans')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// prose sidebars at cell height must never satisfy a spec
// ---------------------------------------------------------------------------

describe('parseDocumentTables — sidebar boxes and integer cells', () => {
  it('a prose sidebar whose box body renders at cell height yields no table', () => {
    // "Self-Sufficiency"-shaped: sidebar-tier caption + cell-height prose.
    // No spec anchors on it, and even a same-named spec could not match
    // because the exact header line is absent.
    const page = tieredPage(73, [
      ['Self-Sufficiency', SIDEBAR],
      ['The expenses and lifestyles described here assume', CELL],
      ['that you are spending your time between adventures', CELL],
      ['in town.', CELL],
    ]);
    expect(parseDocumentTables([page])).toEqual([]);
  });

  it('emits integer cells for the reviewed numeric columns (Creating Spell Slots)', () => {
    const page = tieredPage(43, [
      ['Creating Spell Slots', LEAF],
      ['Spell Slot Sorcery', CELL],
      ['Level Point Cost', CELL],
      ['1st 2', CELL],
      ['2nd 3', CELL],
      ['3rd 5', CELL],
      ['4th 6', CELL],
      ['5th 7', CELL],
      ['Converting a Spell Slot to Sorcery Points. As a', BODY],
    ]);
    const table = byName([page]).get('Creating Spell Slots');
    expect(table).toBeDefined();
    expect(table?.columns).toEqual(['Spell Slot Level', 'Sorcery Point Cost']);
    expect(table?.rows).toEqual([
      ['1st', 2],
      ['2nd', 3],
      ['3rd', 5],
      ['4th', 6],
      ['5th', 7],
    ]);
  });
});

describe('parseDocumentTables — magic-item embedded content', () => {
  it('reconstructs both halves of a paired resistance option table', () => {
    const page = tieredPage(209, [
      ['Armor of Resistance', LEAF],
      ['Armor (light, medium, or heavy), rare', BODY],
      ['d10 Damage Type d10 Damage Type', CELL],
      ['1 Acid 6 Necrotic', CELL],
      ['2 Cold 7 Poison', CELL],
      ['3 Fire 8 Psychic', CELL],
      ['4 Force 9 Radiant', CELL],
      ['5 Lightning 10 Thunder', CELL],
      ['Armor of Vulnerability', LEAF],
    ]);

    const table = byName([page]).get('Armor of Resistance');
    expect(table?.columns).toEqual(['d10', 'Damage Type']);
    expect(table?.rows).toEqual([
      [1, 'Acid'],
      [2, 'Cold'],
      [3, 'Fire'],
      [4, 'Force'],
      [5, 'Lightning'],
      [6, 'Necrotic'],
      [7, 'Poison'],
      [8, 'Psychic'],
      [9, 'Radiant'],
      [10, 'Thunder'],
    ]);
  });

  it('emits a card option table under its owning magic item', () => {
    const page = tieredPage(216, [
      ['Deck of Illusions', LEAF],
      ['Wondrous item, uncommon', BODY],
      ['Playing Card Illusion', CELL],
      ['Ace of hearts Red dragon', CELL],
      ['King of hearts Knight and four guards', CELL],
      ['Jokers (2) You (the deck’s owner)', CELL],
      ['Deck of Many Things', LEAF],
    ]);

    const table = parseDocumentTables(
      [page],
      SRD_5_1_DOCUMENT_TABLE_SPECS.map((spec) =>
        spec.name === 'Deck of Illusions' ? { ...spec, expectedRows: 3 } : spec,
      ),
    ).find((candidate) => candidate.name === 'Deck of Illusions');
    expect(table?.columns).toEqual(['Playing Card', 'Illusion']);
    expect(table?.rows).toEqual([
      ['Ace of hearts', 'Red dragon'],
      ['King of hearts', 'Knight and four guards'],
      ['Jokers (2)', 'You (the deck’s owner)'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// spec hygiene
// ---------------------------------------------------------------------------

describe('SRD_5_1_DOCUMENT_TABLE_SPECS hygiene', () => {
  it('spec names are unique (stable table identities)', () => {
    const names = SRD_5_1_DOCUMENT_TABLE_SPECS.map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every spec demands at least one header line and a positive row count', () => {
    for (const spec of SRD_5_1_DOCUMENT_TABLE_SPECS) {
      expect(spec.headerLines.length).toBeGreaterThan(0);
      expect(spec.expectedRows).toBeGreaterThan(0);
      expect(spec.columns.length).toBeGreaterThan(0);
    }
  });
});
