/**
 * Base-class parser unit tests for the D&D 5e SRD 5.1 importer.
 *
 * Class-feature excerpts in this file are reproduced from the System Reference
 * Document 5.1 by Wizards of the Coast LLC, available under the Creative
 * Commons Attribution 4.0 International License (CC-BY-4.0). Excerpts are used
 * as parser test input; no modification has been made beyond reformatting to
 * match the importer's extracted-line input shape.
 *
 * Scope per ADR 0009 / loreweaver-0m9.5.2: base classes only. The "Primary
 * Ability" cases use a synthetic, clearly-non-SRD class ("Testblade") because
 * the SRD 5.1 Class Features block does not print a primary-ability line — see
 * the parser header. Faithful SRD blocks (Fighter, Wizard) therefore yield
 * `primaryAbilities: []`.
 */

import { describe, expect, it } from 'vitest';
import { parseClasses } from '../../../scripts/importers/dnd5e-srd-5.1/parseClasses.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

// ---------------------------------------------------------------------------
// Fighter — a simple martial class (full armor, no spellcasting).
// ---------------------------------------------------------------------------

const FIGHTER_PAGE = page(70, [
  'Fighter',
  'A master of martial combat, skilled with a variety of weapons and armor.',
  'Class Features',
  'As a fighter, you gain the following class features.',
  'Hit Points',
  'Hit Dice: 1d10 per fighter level',
  'Hit Points at 1st Level: 10 + your Constitution modifier',
  'Hit Points at Higher Levels: 1d10 (or 6) + your Constitution modifier per',
  'fighter level after 1st',
  'Proficiencies',
  'Armor: All armor, shields',
  'Weapons: Simple weapons, martial weapons',
  'Tools: None',
  'Saving Throws: Strength, Constitution',
  'Skills: Choose two skills from Acrobatics, Animal Handling, Athletics, History',
]);

describe('parseClasses — Fighter (simple martial class)', () => {
  const [fighter] = parseClasses([FIGHTER_PAGE]);

  it('extracts the class name from the Hit Dice signature line', () => {
    expect(fighter.name).toBe('Fighter');
  });

  it('extracts the hit die size', () => {
    expect(fighter.hitDie).toBe(10);
  });

  it('extracts armor proficiencies', () => {
    expect(fighter.armorProficiencies).toEqual(['All armor', 'shields']);
  });

  it('extracts weapon proficiencies', () => {
    expect(fighter.weaponProficiencies).toEqual([
      'Simple weapons',
      'martial weapons',
    ]);
  });

  it('extracts saving throw proficiencies', () => {
    expect(fighter.savingThrowProficiencies).toEqual([
      'Strength',
      'Constitution',
    ]);
  });

  it('leaves primaryAbilities empty (no primary-ability line in the SRD block)', () => {
    expect(fighter.primaryAbilities).toEqual([]);
  });

  it('records the source page of the Hit Dice line', () => {
    expect(fighter.sourcePage).toBe(70);
  });
});

// ---------------------------------------------------------------------------
// Wizard — a complex caster (no armor proficiency, longer weapon list). This
// fixture is "real-PDF-shaped": the labels carry literal tab characters (`\t`)
// the way `extract.ts` emits column-spaced labels from the PDF, and the weapon
// proficiency list wraps onto an unlabeled continuation line. Explicit `\t`
// escapes (rather than runs of literal spaces, which a formatter could collapse)
// keep the whitespace-normalization regression unambiguous. Exercises
// normalization (issue: tabbed labels) and continuation collection (issue:
// truncated wrapped lists).
// ---------------------------------------------------------------------------

const WIZARD_PAGE = page(112, [
  'Wizard',
  'A scholarly magic-user capable of manipulating the structures of reality.',
  'Class Features',
  'As a wizard, you gain the following class features.',
  'Hit Points',
  'Hit\tDice: 1d6 per wizard level',
  'Hit Points at 1st Level: 6 + your Constitution modifier',
  'Proficiencies',
  'Armor: None',
  'Weapons: Daggers, darts, slings, quarterstaffs,',
  'light crossbows',
  'Tools: None',
  'Saving\tThrows: Intelligence, Wisdom',
  'Skills: Choose two from Arcana, History, Insight, Investigation, Medicine, Religion',
]);

describe('parseClasses — Wizard (tabbed labels + wrapped weapon list)', () => {
  const [wizard] = parseClasses([WIZARD_PAGE]);

  it('detects the class despite a tab inside the "Hit\\tDice:" label', () => {
    expect(wizard.name).toBe('Wizard');
    expect(wizard.hitDie).toBe(6);
  });

  it('maps "Armor: None" to an empty proficiency array', () => {
    expect(wizard.armorProficiencies).toEqual([]);
  });

  it('captures a weapon list that wraps onto a continuation line', () => {
    expect(wizard.weaponProficiencies).toEqual([
      'Daggers',
      'darts',
      'slings',
      'quarterstaffs',
      'light crossbows',
    ]);
  });

  it('extracts saving throws despite internal whitespace in the label', () => {
    expect(wizard.savingThrowProficiencies).toEqual(['Intelligence', 'Wisdom']);
  });
});

// ---------------------------------------------------------------------------
// Multiple classes in one slice — extracted and sorted by name.
// ---------------------------------------------------------------------------

describe('parseClasses — multiple classes', () => {
  it('extracts every class in the slice, sorted by name', () => {
    const classes = parseClasses([WIZARD_PAGE, FIGHTER_PAGE]);
    expect(classes.map((c) => c.name)).toEqual(['Fighter', 'Wizard']);
  });
});

// ---------------------------------------------------------------------------
// Optional primary-ability line — synthetic (non-SRD) class. Exercises the
// "or"/"and" list splitting and the populated-primaryAbilities path that a
// variant layout or homebrew pack could supply.
// ---------------------------------------------------------------------------

const TESTBLADE_PAGE = page(900, [
  'Testblade',
  'Hit Dice: 1d8 per testblade level',
  'Armor: Light armor, medium armor',
  'Weapons: Simple weapons',
  'Saving Throws: Dexterity, Charisma',
  'Primary Ability: Strength or Dexterity',
]);

describe('parseClasses — optional primary-ability line', () => {
  const [testblade] = parseClasses([TESTBLADE_PAGE]);

  it('parses a present Primary Ability line, splitting on "or"', () => {
    expect(testblade.primaryAbilities).toEqual(['Strength', 'Dexterity']);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed — a confirmed class missing a required proficiency line.
// ---------------------------------------------------------------------------

describe('parseClasses — fail closed on a malformed class', () => {
  it('throws when a class with a Hit Dice line is missing its Armor line', () => {
    const malformed = page(70, [
      'Brokenclass',
      'Hit Dice: 1d10 per brokenclass level',
      'Weapons: Simple weapons',
      'Saving Throws: Strength, Constitution',
    ]);
    expect(() => parseClasses([malformed])).toThrow(/missing an Armor/);
  });

  it('returns an empty array when the slice contains no Hit Dice signature', () => {
    const noClasses = page(70, [
      'Classes',
      'This introductory prose names no class features.',
    ]);
    expect(parseClasses([noClasses])).toEqual([]);
  });
});
