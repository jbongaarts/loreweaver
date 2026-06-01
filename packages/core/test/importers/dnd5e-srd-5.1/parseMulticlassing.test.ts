/**
 * Multiclassing-prerequisites parser unit tests for the D&D 5e SRD 5.1 importer.
 *
 * The prerequisites listing reproduced in this file is from the System
 * Reference Document 5.1 by Wizards of the Coast LLC, available under the
 * Creative Commons Attribution 4.0 International License (CC-BY-4.0). It is used
 * here as parser test input; no modification has been made beyond reformatting
 * to match the importer's extracted-line input shape (the table's "Class" and
 * "Ability Score Minimum" columns join into one line per row).
 *
 * Scope per loreweaver-0m9.5.19 / ADR 0009: extract the class → primary-ability
 * map the class emitter uses to populate `data.primaryAbilities`.
 */

import { describe, expect, it } from 'vitest';
import { parseMulticlassing } from '../../../scripts/importers/dnd5e-srd-5.1/parseMulticlassing.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

// The SRD 5.1 "Multiclassing Prerequisites" table, with each row's two columns
// joined the way pdfjs extraction yields them. A "Proficiencies" heading follows
// the table in the real section; included here so the fixture mirrors the slice
// the orchestrator passes in.
const MULTICLASSING_PAGE = page(165, [
  'Multiclassing Prerequisites',
  'Class Ability Score Minimum',
  'Barbarian Strength 13',
  'Bard Charisma 13',
  'Cleric Wisdom 13',
  'Druid Wisdom 13',
  'Fighter Strength 13 or Dexterity 13',
  'Monk Dexterity 13 and Wisdom 13',
  'Paladin Strength 13 and Charisma 13',
  'Ranger Dexterity 13 and Wisdom 13',
  'Rogue Dexterity 13',
  'Sorcerer Charisma 13',
  'Warlock Charisma 13',
  'Wizard Intelligence 13',
  'Proficiencies',
]);

describe('parseMulticlassing', () => {
  const map = parseMulticlassing([MULTICLASSING_PAGE]);

  it('parses a single-ability prerequisite (Wizard → Intelligence)', () => {
    expect(map.get('Wizard')).toEqual(['Intelligence']);
  });

  it('parses an "or" prerequisite preserving order (Fighter → Strength, Dexterity)', () => {
    expect(map.get('Fighter')).toEqual(['Strength', 'Dexterity']);
  });

  it('parses an "and" prerequisite preserving order (Monk → Dexterity, Wisdom)', () => {
    expect(map.get('Monk')).toEqual(['Dexterity', 'Wisdom']);
  });

  it('covers all twelve SRD base classes', () => {
    expect([...map.keys()].sort()).toEqual(
      [
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
      ].sort(),
    );
  });

  it('maps each remaining class to its single key ability', () => {
    expect(map.get('Barbarian')).toEqual(['Strength']);
    expect(map.get('Bard')).toEqual(['Charisma']);
    expect(map.get('Cleric')).toEqual(['Wisdom']);
    expect(map.get('Druid')).toEqual(['Wisdom']);
    expect(map.get('Paladin')).toEqual(['Strength', 'Charisma']);
    expect(map.get('Ranger')).toEqual(['Dexterity', 'Wisdom']);
    expect(map.get('Rogue')).toEqual(['Dexterity']);
    expect(map.get('Sorcerer')).toEqual(['Charisma']);
    expect(map.get('Warlock')).toEqual(['Charisma']);
  });
});

describe('parseMulticlassing — fail-safe (no model-authored values)', () => {
  it('ignores a bare class heading with no ability-score row', () => {
    // A class name that appears without a prerequisites value (e.g. a stray
    // chapter heading or a class-spell-list header) must not enter the map.
    const map = parseMulticlassing([
      page(40, ['Wizard', 'Wizard Spells', 'Cantrips (0 Level)']),
    ]);
    expect(map.has('Wizard')).toBe(false);
  });

  it('returns an empty map for a slice with no prerequisites rows', () => {
    const map = parseMulticlassing([
      page(1, ['Multiclassing', 'When you gain a level, you can multiclass.']),
    ]);
    expect(map.size).toBe(0);
  });

  it('keeps the first occurrence of a class (table row precedes prose mentions)', () => {
    const map = parseMulticlassing([
      page(165, [
        'Fighter Strength 13 or Dexterity 13',
        'Fighter Intelligence 13',
      ]),
    ]);
    expect(map.get('Fighter')).toEqual(['Strength', 'Dexterity']);
  });
});
