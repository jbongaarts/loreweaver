/**
 * Equipment-parser unit tests for the D&D 5e SRD 5.1 importer.
 *
 * Equipment table excerpts in this file are reproduced from the System
 * Reference Document 5.1 by Wizards of the Coast LLC, available under the
 * Creative Commons Attribution 4.0 International License (CC-BY-4.0). Excerpts
 * are used as parser test input; no modification has been made beyond
 * reformatting to match the importer's extracted-line input shape.
 *
 * Fixture shape (loreweaver-3n6): these fixtures mirror how the vendored
 * SRD 5.1 PDF actually extracts — the Armor and Weapons tables arrive split
 * into a LEFT column-block (Name/Cost/AC or Name/Cost/Damage) and a RIGHT
 * column-block (Strength/Stealth/Weight or Weight/Properties), with descriptive
 * prose interleaved between them; the Tools table extracts row-major. See the
 * header comment in `parseEquipment.ts`.
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
// A trimmed Equipment chapter holding all four tables in the real extracted
// layout: each of Armor and Weapons is a left column-block followed (after
// interleaved prose) by a right column-block; Tools is row-major. Descriptive
// section headings that duplicate the table sub-headers ("Heavy Armor") are
// included to prove they do not corrupt the parse.
// ---------------------------------------------------------------------------

const EQUIPMENT_PAGE = page(63, [
  // --- Armor: descriptive prose headings (duplicate the table sub-headers) ---
  'Light Armor',
  'Made from supple and thin materials, light armor favors agile adventurers.',
  'Heavy Armor',
  'Of all the armor categories, heavy armor offers the best protection.',
  // --- Armor: left column-block (Name Cost ArmorClass) ---
  'Armor',
  'Armor Cost Armor Class (AC)',
  'Light Armor',
  'Padded 5 gp 11 + Dex modifier',
  'Leather 10 gp 11 + Dex modifier',
  'Medium Armor',
  'Scale mail 50 gp 14 + Dex modifier (max 2)',
  'Heavy Armor',
  'Plate 1,500 gp 18',
  'Shield',
  'Shield 10 gp +2',
  // --- Armor: right column-block (Strength Stealth Weight), one row per left
  //     row, in the same order: Padded, Leather, Scale mail, Plate, Shield. ---
  'Strength Stealth Weight',
  '— Disadvantage 8 lb.',
  '— — 10 lb.',
  '— Disadvantage 45 lb.',
  'Str 15 Disadvantage 65 lb.',
  '— — 6 lb.',
  // --- Weapons: left column-block (Name Cost Damage) ---
  'Weapons',
  'Name Cost Damage Weight Properties',
  'Simple Melee Weapons',
  'Dagger 2 gp 1d4 piercing',
  'Mace 5 gp 1d6 bludgeoning',
  'Martial Melee Weapons',
  'Longsword 15 gp 1d8 slashing',
  'Martial Ranged Weapons',
  'Net 1 gp —',
  // --- Adventuring Gear heading + prose, then the weapons right column-block ---
  'Adventuring Gear',
  'This section describes items that have special rules.',
  'Acid. As an action, you can splash the contents of this vial.',
  '1 lb. Finesse, light, thrown (range 20/60)',
  '4 lb. —',
  '3 lb. Versatile (1d10)',
  '3 lb. Special, thrown (range 5/15)',
  'ranged attack against a creature or object, treating',
  // --- Tools: row-major ---
  'Tools',
  'Item Cost Weight',
  'Artisan’s tools',
  'Smith’s tools 20 gp 8 lb.',
  'Gaming set',
  'Dice set 1 sp —',
  'Thieves’ tools 25 gp 1 lb.',
  'Vehicles (land or water) * *',
  'Artisan’s Tools. These special tools include the items needed to pursue a craft.',
]);

describe('parseEquipment — full multi-table excerpt', () => {
  const items = parseEquipment([EQUIPMENT_PAGE]);

  it('extracts every armor, weapon, and tool entry and nothing more', () => {
    expect(items.map((i) => i.name)).toEqual([
      'Dagger',
      'Dice set',
      'Leather',
      'Longsword',
      'Mace',
      'Net',
      'Padded',
      'Plate',
      'Scale mail',
      'Shield',
      'Smith’s tools',
      'Thieves’ tools',
    ]);
  });

  it('does not promote table titles, sub-headers, column rows, or prose as entries', () => {
    const names = new Set(items.map((i) => i.name));
    for (const notAnItem of [
      'Armor',
      'Light Armor',
      'Heavy Armor',
      'Simple Melee Weapons',
      'Adventuring Gear',
      'Tools',
      'Artisan’s tools',
      'Gaming set',
      'Vehicles (land or water)',
    ]) {
      expect(names.has(notAnItem)).toBe(false);
    }
  });

  it('does not emit adventuring-gear rows (intentionally out of scope)', () => {
    // The gear table is documented out of scope; nothing from it is emitted.
    const categories = new Set(items.map((i) => i.category));
    expect(categories.has('gear')).toBe(false);
  });

  it('records the source page for every entry', () => {
    for (const item of items) {
      expect(item.sourcePage).toBe(63);
    }
  });
});

// ---------------------------------------------------------------------------
// Armor: weight class is derived from the AC cell, and the right column-block
// is zipped positionally onto the left rows for strength/stealth/weight.
// ---------------------------------------------------------------------------

describe('parseEquipment — armor', () => {
  const items = parseEquipment([EQUIPMENT_PAGE]);

  it('parses light armor (padded) with stealth disadvantage and weight', () => {
    expect(byName(items, 'Padded')).toMatchObject({
      name: 'Padded',
      category: 'armor',
      cost: '5 gp',
      ac: '11 + Dex modifier',
      armorType: 'light',
      stealthDisadvantage: true,
      weight: '8 lb.',
    });
    expect(byName(items, 'Padded')?.strengthRequirement).toBeUndefined();
  });

  it('parses light armor (leather) without strength or stealth penalty', () => {
    expect(byName(items, 'Leather')).toMatchObject({
      name: 'Leather',
      category: 'armor',
      cost: '10 gp',
      ac: '11 + Dex modifier',
      armorType: 'light',
      stealthDisadvantage: false,
      weight: '10 lb.',
    });
  });

  it('classifies medium armor (scale mail) from its capped Dex AC', () => {
    expect(byName(items, 'Scale mail')).toMatchObject({
      name: 'Scale mail',
      category: 'armor',
      ac: '14 + Dex modifier (max 2)',
      armorType: 'medium',
      stealthDisadvantage: true,
      weight: '45 lb.',
    });
  });

  it('parses heavy armor (plate) with a strength requirement', () => {
    expect(byName(items, 'Plate')).toMatchObject({
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

  it('classifies a shield from its bonus AC', () => {
    expect(byName(items, 'Shield')).toMatchObject({
      name: 'Shield',
      category: 'armor',
      ac: '+2',
      armorType: 'shield',
      stealthDisadvantage: false,
      weight: '6 lb.',
    });
  });

  // Regression: the SRD prints "Light Armor"/"Heavy Armor" as body-prose section
  // headings interleaved with the table, so a sub-header-tracking parser would
  // misclassify rows that straddle the headings. The AC-cell classifier must be
  // immune — Leather here is preceded in document order by a "Heavy Armor"
  // descriptive heading but is still light armor.
  it('ignores duplicate prose section headings when classifying weight class', () => {
    expect(byName(items, 'Leather')?.armorType).toBe('light');
  });
});

// ---------------------------------------------------------------------------
// Weapons: the right column-block (weight + properties) is zipped onto the left
// rows (name/cost/damage), including the dash-damage Net and dash-weight cells.
// ---------------------------------------------------------------------------

describe('parseEquipment — weapons', () => {
  const items = parseEquipment([EQUIPMENT_PAGE]);

  it('parses a simple weapon (dagger) with structured fields', () => {
    expect(byName(items, 'Dagger')).toMatchObject({
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
    expect(byName(items, 'Longsword')).toMatchObject({
      name: 'Longsword',
      category: 'weapon',
      cost: '15 gp',
      damageDie: '1d8',
      damageType: 'slashing',
      weight: '3 lb.',
      properties: ['Versatile (1d10)'],
    });
  });

  it('emits an empty property list when the right cell is a dash', () => {
    expect(byName(items, 'Mace')).toMatchObject({
      name: 'Mace',
      category: 'weapon',
      damageDie: '1d6',
      damageType: 'bludgeoning',
      weight: '4 lb.',
      properties: [],
    });
  });

  // The Net is the only SRD weapon with a "—" damage cell; it must still parse
  // (no damage fields) and pick up its zipped weight/properties.
  it('parses a weapon whose damage cell is a dash (Net)', () => {
    const net = byName(items, 'Net');
    expect(net).toMatchObject({
      name: 'Net',
      category: 'weapon',
      cost: '1 gp',
      weight: '3 lb.',
      properties: ['Special', 'thrown (range 5/15)'],
    });
    expect(net?.damageDie).toBeUndefined();
    expect(net?.damageType).toBeUndefined();
  });

  it('does not attach armor fields to a weapon', () => {
    const dagger = byName(items, 'Dagger');
    expect(dagger?.ac).toBeUndefined();
    expect(dagger?.armorType).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tools: row-major; category sub-headers (no cost cell) are skipped.
// ---------------------------------------------------------------------------

describe('parseEquipment — tools', () => {
  const items = parseEquipment([EQUIPMENT_PAGE]);

  it('parses a tool row into name/cost/weight', () => {
    expect(byName(items, 'Smith’s tools')).toMatchObject({
      name: 'Smith’s tools',
      category: 'tool',
      cost: '20 gp',
      weight: '8 lb.',
    });
  });

  it('omits weight when the tool weight cell is a dash', () => {
    const dice = byName(items, 'Dice set');
    expect(dice).toMatchObject({
      name: 'Dice set',
      category: 'tool',
      cost: '1 sp',
    });
    expect(dice?.weight).toBeUndefined();
  });

  it('stops the tool table at the Vehicles row', () => {
    expect(byName(items, 'Vehicles (land or water)')).toBeUndefined();
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
      'Dagger 2 gp 1d4 piercing',
      'Adventuring Gear',
      '1 lb. Finesse, light, thrown (range 20/60)',
    ]);
    const p2 = page(64, [
      'Armor',
      'Armor Cost Armor Class (AC)',
      'Leather 10 gp 11 + Dex modifier',
      'Strength Stealth Weight',
      '— — 10 lb.',
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
