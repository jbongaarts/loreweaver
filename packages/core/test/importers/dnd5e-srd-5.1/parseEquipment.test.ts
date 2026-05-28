/**
 * Equipment-parser unit tests for the D&D 5e SRD 5.1 importer.
 *
 * Equipment table excerpts in this file are reproduced from the System
 * Reference Document 5.1 by Wizards of the Coast LLC, available under the
 * Creative Commons Attribution 4.0 International License (CC-BY-4.0). Excerpts
 * are used as parser test input; no modification has been made beyond
 * reformatting to match the importer's extracted-line input shape.
 */

import { describe, expect, it } from 'vitest';
import { parseEquipment } from '../../../scripts/importers/dnd5e-srd-5.1/parseEquipment.js';
import type {
  EquipmentExtraction,
  PageText,
} from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

function byName(
  items: readonly EquipmentExtraction[],
  name: string,
): EquipmentExtraction | undefined {
  return items.find((i) => i.name === name);
}

// ---------------------------------------------------------------------------
// A trimmed Equipment chapter holding all three tables. Mirrors the SRD 5.1
// layout: a table title, its column-header row, then category sub-headers and
// item rows. "Mounts and Vehicles" closes the gear table.
// ---------------------------------------------------------------------------

const EQUIPMENT_PAGE = page(63, [
  'Armor',
  'Armor Cost Armor Class (AC) Strength Stealth Weight',
  'Light Armor',
  'Leather 10 gp 11 + Dex modifier 10 lb.',
  'Medium Armor',
  'Scale mail 50 gp 14 + Dex modifier (max 2) Disadvantage 45 lb.',
  'Heavy Armor',
  'Plate 1,500 gp 18 Str 15 Disadvantage 65 lb.',
  'Weapons',
  'Name Cost Damage Weight Properties',
  'Simple Melee Weapons',
  'Dagger 2 gp 1d4 piercing 1 lb. Finesse, light, thrown (range 20/60)',
  'Martial Melee Weapons',
  'Longsword 15 gp 1d8 slashing 3 lb. Versatile (1d10)',
  'Adventuring Gear',
  'Item Cost Weight',
  'Rope, hempen (50 feet) 1 gp 10 lb.',
  'Mounts and Vehicles',
  'Warhorse 400 gp',
]);

describe('parseEquipment — full three-table excerpt', () => {
  const items = parseEquipment([EQUIPMENT_PAGE]);

  it('extracts every entry from all three tables and nothing more', () => {
    expect(items.map((i) => i.name)).toEqual([
      'Dagger',
      'Leather',
      'Longsword',
      'Plate',
      'Rope, hempen (50 feet)',
      'Scale mail',
    ]);
  });

  it('does not promote table titles, sub-headers, or column rows as entries', () => {
    const names = new Set(items.map((i) => i.name));
    expect(names.has('Light Armor')).toBe(false);
    expect(names.has('Simple Melee Weapons')).toBe(false);
    expect(names.has('Adventuring Gear')).toBe(false);
  });

  it('stops the gear table at the next chapter subsection (Mounts and Vehicles)', () => {
    expect(byName(items, 'Warhorse')).toBeUndefined();
  });

  it('records the source page for every entry', () => {
    for (const item of items) {
      expect(item.sourcePage).toBe(63);
    }
  });
});

// ---------------------------------------------------------------------------
// Weapons: a simple weapon (dagger) and a martial weapon (longsword).
// ---------------------------------------------------------------------------

describe('parseEquipment — weapons', () => {
  const items = parseEquipment([EQUIPMENT_PAGE]);

  it('parses a simple weapon (dagger) with structured fields', () => {
    const dagger = byName(items, 'Dagger');
    expect(dagger).toMatchObject({
      name: 'Dagger',
      category: 'weapon',
      cost: '2 gp',
      damageDie: '1d4',
      damageType: 'piercing',
      weight: '1 lb.',
      properties: ['Finesse', 'light', 'thrown (range 20/60)'],
    });
  });

  it('parses a martial weapon (longsword) with structured fields', () => {
    const longsword = byName(items, 'Longsword');
    expect(longsword).toMatchObject({
      name: 'Longsword',
      category: 'weapon',
      cost: '15 gp',
      damageDie: '1d8',
      damageType: 'slashing',
      weight: '3 lb.',
      properties: ['Versatile (1d10)'],
    });
  });

  it('emits an empty property list when a weapon has none', () => {
    const items2 = parseEquipment([
      page(64, [
        'Weapons',
        'Name Cost Damage Weight Properties',
        'Simple Melee Weapons',
        'Mace 5 gp 1d6 bludgeoning 4 lb. —',
      ]),
    ]);
    expect(byName(items2, 'Mace')?.properties).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Armor: light (leather), medium (scale mail), heavy (plate).
// ---------------------------------------------------------------------------

describe('parseEquipment — armor', () => {
  const items = parseEquipment([EQUIPMENT_PAGE]);

  it('parses light armor (leather) without strength or stealth penalty', () => {
    const leather = byName(items, 'Leather');
    expect(leather).toMatchObject({
      name: 'Leather',
      category: 'armor',
      cost: '10 gp',
      ac: '11 + Dex modifier',
      armorType: 'light',
      stealthDisadvantage: false,
      weight: '10 lb.',
    });
    expect(leather?.strengthRequirement).toBeUndefined();
  });

  it('parses medium armor (scale mail) with stealth disadvantage', () => {
    const scale = byName(items, 'Scale mail');
    expect(scale).toMatchObject({
      name: 'Scale mail',
      category: 'armor',
      cost: '50 gp',
      ac: '14 + Dex modifier (max 2)',
      armorType: 'medium',
      stealthDisadvantage: true,
      weight: '45 lb.',
    });
    expect(scale?.strengthRequirement).toBeUndefined();
  });

  it('parses heavy armor (plate) with a strength requirement and stealth disadvantage', () => {
    const plate = byName(items, 'Plate');
    expect(plate).toMatchObject({
      name: 'Plate',
      category: 'armor',
      cost: '1,500 gp',
      ac: '18',
      armorType: 'heavy',
      stealthDisadvantage: true,
      strengthRequirement: 15,
      weight: '65 lb.',
    });
  });
});

// ---------------------------------------------------------------------------
// Adventuring gear: a piece with a comma- and paren-bearing name (rope).
// ---------------------------------------------------------------------------

describe('parseEquipment — adventuring gear', () => {
  const items = parseEquipment([EQUIPMENT_PAGE]);

  it('parses gear with a complex name into name/cost/weight', () => {
    const rope = byName(items, 'Rope, hempen (50 feet)');
    expect(rope).toMatchObject({
      name: 'Rope, hempen (50 feet)',
      category: 'gear',
      cost: '1 gp',
      weight: '10 lb.',
    });
  });

  it('does not attach weapon/armor fields to gear', () => {
    const rope = byName(items, 'Rope, hempen (50 feet)');
    expect(rope?.damageDie).toBeUndefined();
    expect(rope?.ac).toBeUndefined();
    expect(rope?.properties).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Multi-page + empty input.
// ---------------------------------------------------------------------------

describe('parseEquipment — page boundaries and empty input', () => {
  it('assigns sourcePage from the page each row appears on', () => {
    const p1 = page(63, [
      'Weapons',
      'Name Cost Damage Weight Properties',
      'Simple Melee Weapons',
      'Dagger 2 gp 1d4 piercing 1 lb. Finesse, light, thrown (range 20/60)',
    ]);
    const p2 = page(64, [
      'Armor',
      'Light Armor',
      'Leather 10 gp 11 + Dex modifier 10 lb.',
    ]);
    const items = parseEquipment([p1, p2]);
    expect(byName(items, 'Dagger')?.sourcePage).toBe(63);
    expect(byName(items, 'Leather')?.sourcePage).toBe(64);
  });

  it('returns an empty array for empty input', () => {
    expect(parseEquipment([])).toEqual([]);
  });

  it('returns an empty array when no equipment tables are present', () => {
    expect(
      parseEquipment([
        page(1, ['Currency', 'The most common coins are gold.']),
      ]),
    ).toEqual([]);
  });
});
