/**
 * Feature parser unit tests for the D&D 5e SRD 5.1 importer.
 *
 * Feature excerpts in this file are reproduced from the System Reference
 * Document 5.1 by Wizards of the Coast LLC, available under the Creative
 * Commons Attribution 4.0 International License (CC-BY-4.0). Excerpts are used
 * as parser test input; no modification has been made beyond reformatting to
 * match the importer's extracted-line input shape, and bodies are trimmed to a
 * representative paragraph or two.
 *
 * Scope per ADR 0009 / loreweaver-0m9.5.18: class- and subclass-granted
 * features. Cases cover a simple class feature with no in-prose level (Second
 * Wind → Fighter, level 1), a level-scaling class feature whose grant level
 * must NOT be confused with a later scaling mention (Rage → Barbarian, level 1
 * despite "At 3rd level …" in the body), and subclass-granted features that
 * carry an explicit level lead-in (Channel Divinity → Life Domain, level 2;
 * Improved Critical → Champion, level 3).
 */

import { describe, expect, it } from 'vitest';
import { parseFeatures } from '../../../scripts/importers/dnd5e-srd-5.1/parseFeatures.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

// ---------------------------------------------------------------------------
// Simple class feature: Second Wind (Fighter). Its SRD prose carries no level
// — the grant level (1) comes from the class progression, so the parser must
// fall back to level 1 when no lead-in is present.
// ---------------------------------------------------------------------------

const FIGHTER_SECOND_WIND = page(72, [
  'Fighter',
  'Class Features',
  'Hit Dice: 1d10 per fighter level',
  'Armor: All armor, shields',
  'Weapons: Simple weapons, martial weapons',
  'Saving Throws: Strength, Constitution',
  'Second Wind',
  'You have a limited well of stamina that you can draw on to protect',
  'yourself from harm. On your turn, you can use a bonus action to regain',
  'hit points equal to 1d10 + your fighter level. Once you use this feature,',
  'you must finish a short or long rest before you can use it again.',
]);

describe('parseFeatures — simple class feature (Second Wind)', () => {
  const [second] = parseFeatures([FIGHTER_SECOND_WIND]);

  it('extracts the feature by its heading name', () => {
    expect(second.name).toBe('Second Wind');
  });

  it('links it to the granting base class', () => {
    expect(second.grantorKind).toBe('class');
    expect(second.grantorName).toBe('Fighter');
  });

  it('defaults to level 1 when the prose carries no level lead-in', () => {
    expect(second.level).toBe(1);
  });

  it('captures the feature body prose', () => {
    expect(second.description).toMatch(/limited well of stamina/);
    expect(second.description).not.toMatch(/Saving Throws/);
  });

  it('records the source page of the feature', () => {
    expect(second.sourcePage).toBe(72);
  });
});

// ---------------------------------------------------------------------------
// Level-scaling class feature: Rage (Barbarian). Gained at 1st level, but the
// body mentions a later scaling level. The parser must record the GRANT level
// (1), taken from the absence of a leading lead-in, NOT the "At 3rd level"
// scaling mention deeper in the body.
// ---------------------------------------------------------------------------

const BARBARIAN_RAGE = page(48, [
  'Barbarian',
  'Class Features',
  'Hit Dice: 1d12 per barbarian level',
  'Armor: Light armor, medium armor, shields',
  'Weapons: Simple weapons, martial weapons',
  'Saving Throws: Strength, Constitution',
  'Rage',
  'In battle, you fight with primal ferocity. On your turn, you can enter a',
  'rage as a bonus action.',
  'While raging, you gain the bonus damage shown in the Rage Damage column of',
  'the Barbarian table.',
  'At 3rd level, your rage damage bonus increases to +2.',
]);

describe('parseFeatures — level-scaling class feature (Rage)', () => {
  const [rage] = parseFeatures([BARBARIAN_RAGE]);

  it('extracts the feature and links it to the base class', () => {
    expect(rage.name).toBe('Rage');
    expect(rage.grantorKind).toBe('class');
    expect(rage.grantorName).toBe('Barbarian');
  });

  it('records the grant level (1), not a later scaling mention', () => {
    expect(rage.level).toBe(1);
  });

  it('keeps the whole progression in one record body', () => {
    expect(rage.description).toMatch(/primal ferocity/);
    expect(rage.description).toMatch(/At 3rd level/);
  });
});

const WIZARD_SPELLCASTING = page(114, [
  'Wizard',
  'Class Features',
  'Hit Dice: 1d6 per wizard level',
  'Armor: None',
  'Weapons: Daggers, darts, slings, quarterstaffs, light crossbows',
  'Saving Throws: Intelligence, Wisdom',
  'Spellcasting',
  'As a student of arcane magic, you have a spellbook containing spells that',
  'show the first glimmerings of your true power.',
]);

describe('parseFeatures — class feature named Spellcasting', () => {
  const [spellcasting] = parseFeatures([WIZARD_SPELLCASTING]);

  it('extracts Spellcasting as a feature, not as a structural heading', () => {
    expect(spellcasting.name).toBe('Spellcasting');
    expect(spellcasting.grantorKind).toBe('class');
    expect(spellcasting.grantorName).toBe('Wizard');
  });
});

// ---------------------------------------------------------------------------
// Subclass-granted features with explicit level lead-ins.
// ---------------------------------------------------------------------------

const CLERIC_LIFE_DOMAIN_CHANNEL = page(58, [
  'Cleric',
  'Class Features',
  'Hit Dice: 1d8 per cleric level',
  'Armor: Light armor, medium armor, shields',
  'Weapons: Simple weapons',
  'Saving Throws: Wisdom, Charisma',
  'Divine Domains',
  'Each deity governs a number of domains.',
  'Life Domain',
  'The Life domain focuses on the vibrant positive energy that sustains all life.',
  'Channel Divinity',
  'At 2nd level, you gain the ability to channel divine energy directly from',
  'your deity, using that energy to fuel magical effects.',
]);

describe('parseFeatures — subclass feature with a level lead-in (Channel Divinity)', () => {
  const [channel] = parseFeatures([CLERIC_LIFE_DOMAIN_CHANNEL]);

  it('links the feature to its subclass grantor, not the base class', () => {
    expect(channel.name).toBe('Channel Divinity');
    expect(channel.grantorKind).toBe('subclass');
    expect(channel.grantorName).toBe('Life Domain');
  });

  it('reads the level from the leading "At Nth level" clause', () => {
    expect(channel.level).toBe(2);
  });
});

const FIGHTER_CHAMPION_IMPROVED_CRIT = page(72, [
  'Fighter',
  'Class Features',
  'Hit Dice: 1d10 per fighter level',
  'Armor: All armor, shields',
  'Weapons: Simple weapons, martial weapons',
  'Saving Throws: Strength, Constitution',
  'Martial Archetypes',
  'Different fighters choose different approaches to perfecting their martial prowess.',
  'Champion',
  'The archetypal Champion focuses on the development of raw physical power.',
  'Improved Critical',
  'Beginning when you choose this archetype at 3rd level, your weapon attacks',
  'score a critical hit on a roll of 19 or 20.',
]);

describe('parseFeatures — subclass feature with an archetype lead-in (Improved Critical)', () => {
  const [improved] = parseFeatures([FIGHTER_CHAMPION_IMPROVED_CRIT]);

  it('links it to the Champion subclass at the archetype level', () => {
    expect(improved.name).toBe('Improved Critical');
    expect(improved.grantorKind).toBe('subclass');
    expect(improved.grantorName).toBe('Champion');
    expect(improved.level).toBe(3);
  });

  it('does not promote the base-class stat block or subclass intro as features', () => {
    const all = parseFeatures([FIGHTER_CHAMPION_IMPROVED_CRIT]);
    expect(all.map((f) => f.name)).toEqual(['Improved Critical']);
  });
});

// ---------------------------------------------------------------------------
// Multiple features across the class and its subclass in one slice.
// ---------------------------------------------------------------------------

describe('parseFeatures — class + subclass features in one slice', () => {
  const FIGHTER_FULL = page(72, [
    'Fighter',
    'Class Features',
    'Hit Dice: 1d10 per fighter level',
    'Armor: All armor, shields',
    'Weapons: Simple weapons, martial weapons',
    'Saving Throws: Strength, Constitution',
    'Second Wind',
    'You have a limited well of stamina.',
    'Action Surge',
    'Starting at 2nd level, you can push yourself beyond your normal limits.',
    'Martial Archetypes',
    'Different fighters choose different approaches.',
    'Champion',
    'The archetypal Champion focuses on raw physical power.',
    'Improved Critical',
    'Beginning when you choose this archetype at 3rd level, your weapon attacks',
    'score a critical hit on a roll of 19 or 20.',
  ]);

  const features = parseFeatures([FIGHTER_FULL]);

  it('extracts every feature, sorted by name', () => {
    expect(features.map((f) => f.name)).toEqual([
      'Action Surge',
      'Improved Critical',
      'Second Wind',
    ]);
  });

  it('attributes class features to the class and subclass features to the subclass', () => {
    const byName = new Map(features.map((f) => [f.name, f]));
    expect(byName.get('Second Wind')?.grantorName).toBe('Fighter');
    expect(byName.get('Action Surge')?.grantorKind).toBe('class');
    expect(byName.get('Action Surge')?.level).toBe(2);
    expect(byName.get('Improved Critical')?.grantorKind).toBe('subclass');
    expect(byName.get('Improved Critical')?.grantorName).toBe('Champion');
  });
});

// ---------------------------------------------------------------------------
// Fail-closed + empty input.
// ---------------------------------------------------------------------------

describe('parseFeatures — fail closed / empty input', () => {
  it('throws when a detected feature heading has no body text', () => {
    const malformed = page(72, [
      'Fighter',
      'Class Features',
      'Hit Dice: 1d10 per fighter level',
      'Armor: All armor',
      'Weapons: Simple weapons',
      'Saving Throws: Strength, Constitution',
      'Second Wind',
    ]);
    expect(() => parseFeatures([malformed])).toThrow(/no description text/);
  });

  it('returns an empty array when the slice has a class but no features', () => {
    const noFeatures = page(72, [
      'Fighter',
      'Class Features',
      'Hit Dice: 1d10 per fighter level',
      'Armor: All armor',
      'Weapons: Simple weapons',
      'Saving Throws: Strength, Constitution',
    ]);
    expect(parseFeatures([noFeatures])).toEqual([]);
  });

  it('returns an empty array for an empty slice', () => {
    expect(parseFeatures([])).toEqual([]);
  });
});
