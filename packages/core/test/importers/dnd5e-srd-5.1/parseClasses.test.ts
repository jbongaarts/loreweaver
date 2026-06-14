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
// Progression-table interleaving — the SRD prints each class's level table
// directly inside the Proficiencies block, between two proficiency labels, with
// no blank line or label to bound it. The continuation collector must stop at
// the table so its rows and following feature prose don't bleed into the
// preceding proficiency value (eshyra-0m9.12). These fixtures reproduce the
// real extracted line shape for Bard (table after a single-line Armor), Druid
// (table after a wrapped Armor parenthetical), and Monk (table after
// "Armor: None").
// ---------------------------------------------------------------------------

const BARD_TABLE_PAGE = page(11, [
  'Bard',
  'Class Features',
  'As a bard, you gain the following class features.',
  'Hit Points',
  'Hit Dice: 1d8 per bard level',
  'Hit Points at 1st Level: 8 + your Constitution',
  'Proficiencies',
  'Armor: Light armor',
  'The Bard',
  'Proficiency Cantrips',
  'Level Bonus Features Known',
  '1st +2 Spellcasting, Bardic Inspiration',
  '(d6)',
  '2nd +2 Jack of All Trades, Song of Rest',
  '20th +6 Superior Inspiration',
  'Spellcasting',
  'You have learned to untangle and reshape the fabric',
  'Weapons: Simple weapons, hand crossbows,',
  'longswords, rapiers, shortswords',
  'Tools: Three musical instruments of your choice',
  'Saving Throws: Dexterity, Charisma',
  'Skills: Choose any three',
]);

describe('parseClasses — table interleaved after a single-line Armor (Bard)', () => {
  const [bard] = parseClasses([BARD_TABLE_PAGE]);

  it('stops the Armor value at the "The Bard" table title', () => {
    expect(bard.armorProficiencies).toEqual(['Light armor']);
  });

  it('still captures the Weapons list printed after the table', () => {
    expect(bard.weaponProficiencies).toEqual([
      'Simple weapons',
      'hand crossbows',
      'longswords',
      'rapiers',
      'shortswords',
    ]);
  });

  it('captures saving throws printed after the table', () => {
    expect(bard.savingThrowProficiencies).toEqual(['Dexterity', 'Charisma']);
  });

  it('lets no table row or feature prose bleed into any proficiency token', () => {
    const tokens = [
      ...bard.armorProficiencies,
      ...bard.weaponProficiencies,
      ...bard.savingThrowProficiencies,
    ];
    for (const token of tokens) {
      expect(token).not.toMatch(
        /\bThe Bard\b|Proficiency|Spellcasting|\b\d+(?:st|nd|rd|th)\b/,
      );
    }
  });
});

const DRUID_TABLE_PAGE = page(19, [
  'Druid',
  'Hit Dice: 1d8 per druid level',
  'Proficiencies',
  'Armor: Light armor, medium armor, shields (druids',
  'will not wear armor or use shields made of metal)',
  'The Druid',
  'Proficiency Cantrips',
  'Level Bonus Features Known',
  '1st +2 Druidic, Spellcasting',
  'Weapons: Clubs, daggers, darts',
  'Tools: Herbalism kit',
  'Saving Throws: Intelligence, Wisdom',
]);

describe('parseClasses — table after a wrapped Armor parenthetical (Druid)', () => {
  const [druid] = parseClasses([DRUID_TABLE_PAGE]);

  it('normalizes the metal restriction out of the token into proficiencyNotes (eshyra-4a7.6)', () => {
    // The "or" inside "(druids will not wear armor or use shields made of
    // metal)" is parenthetical prose, not a list delimiter, so the shield
    // qualifier first parses as one coherent token (eshyra-0m9.12 review); the
    // trailing parenthetical restriction is then lifted off the normalized
    // "shields" token into proficiencyNotes (eshyra-4a7.6).
    expect(druid.armorProficiencies).toEqual([
      'Light armor',
      'medium armor',
      'shields',
    ]);
    expect(druid.proficiencyNotes).toEqual([
      {
        field: 'armorProficiencies',
        text: 'druids will not wear armor or use shields made of metal',
      },
    ]);
  });

  it('captures the Weapons list after the table without contamination', () => {
    expect(druid.weaponProficiencies).toEqual(['Clubs', 'daggers', 'darts']);
  });
});

const MONK_TABLE_PAGE = page(26, [
  'Monk',
  'Hit Dice: 1d8 per monk level',
  'Proficiencies',
  'Armor: None',
  'The Monk',
  'Level Proficiency Bonus Martial Arts',
  '1st +2 1d4 Unarmored Defense, Martial Arts',
  'Weapons: Simple weapons, shortswords',
  'Tools: Choose one type of artisan’s tools',
  'Saving Throws: Strength, Dexterity',
]);

describe('parseClasses — table after "Armor: None" (Monk)', () => {
  const [monk] = parseClasses([MONK_TABLE_PAGE]);

  it('maps "Armor: None" to an empty array even with a trailing table', () => {
    expect(monk.armorProficiencies).toEqual([]);
  });

  it('captures the Weapons list after the table', () => {
    expect(monk.weaponProficiencies).toEqual(['Simple weapons', 'shortswords']);
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

// ---------------------------------------------------------------------------
// Tools / Skills / Equipment options modeling (eshyra-4a7.6).
// ---------------------------------------------------------------------------

// A Bard-shaped block: choice Tools, "Choose any three" skills, equipment
// bullets, with the table interleaved between Armor and Weapons (as the SRD
// prints it for spellcasters) so the parser must skip the table to find the
// later proficiency lines and stop the equipment block at the table.
const BARD_OPTIONS_PAGE = page(11, [
  'Bard',
  'Hit Dice: 1d8 per bard level',
  'Proficiencies',
  'Armor: Light armor',
  'The Bard',
  'Proficiency Cantrips Spells',
  'Weapons: Simple weapons, hand crossbows, longswords, rapiers,',
  'shortswords',
  'Tools: Three musical instruments of your choice',
  'Saving Throws: Dexterity, Charisma',
  'Skills: Choose any three',
  'Equipment',
  'You start with the following equipment, in addition',
  'to the equipment granted by your background:',
  '• (a) a rapier, (b) a longsword, or (c) any simple',
  'weapon',
  '• (a) a diplomat’s pack or (b) an entertainer’s pack',
  '• Leather armor and a dagger',
  '—Spell Slots per Spell Level—',
  'Level Bonus Features Known',
]);

describe('parseClasses — Tools/Skills/Equipment options (eshyra-4a7.6)', () => {
  const [bard] = parseClasses([BARD_OPTIONS_PAGE]);

  it('parses a Tools choice grant verbatim with its count', () => {
    expect(bard.toolProficiencies).toBeUndefined();
    expect(bard.toolProficiencyChoices).toEqual([
      { text: 'Three musical instruments of your choice', choose: 3 },
    ]);
  });

  it("parses the Bard's 'Choose any three' skills shape", () => {
    expect(bard.skillChoices).toEqual([
      { text: 'Choose any three', any: true, choose: 3 },
    ]);
  });

  it('re-joins wrapped Weapons across a continuation line', () => {
    expect(bard.weaponProficiencies).toEqual([
      'Simple weapons',
      'hand crossbows',
      'longswords',
      'rapiers',
      'shortswords',
    ]);
  });

  it('captures the starting-equipment bullets and stops at the table', () => {
    expect(bard.startingEquipment?.entries).toEqual([
      '(a) a rapier, (b) a longsword, or (c) any simple weapon',
      '(a) a diplomat’s pack or (b) an entertainer’s pack',
      'Leather armor and a dagger',
    ]);
    // The spell-slot table header right after the last bullet must NOT be
    // swallowed into the final equipment entry.
    expect(bard.startingEquipment?.text).not.toMatch(/Spell Slots|Level Bonus/);
  });
});

// A "Choose two from <list>" skills line that wraps across two extracted lines,
// plus a fixed Tools grant — exercises the wrapped-value path and the Oxford
// comma stripping on the final option.
const FIGHTER_SKILLS_PAGE = page(24, [
  'Fighter',
  'Hit Dice: 1d10 per fighter level',
  'Proficiencies',
  'Armor: All armor, shields',
  'Weapons: Simple weapons, martial weapons',
  'Tools: None',
  'Saving Throws: Strength, Constitution',
  'Skills: Choose two skills from Acrobatics, Animal Handling, Athletics,',
  'History, Insight, Intimidation, Perception, and Survival',
]);

describe('parseClasses — wrapped Skills list (eshyra-4a7.6)', () => {
  const [fighter] = parseClasses([FIGHTER_SKILLS_PAGE]);

  it('parses a wrapped "Choose two skills from …" list without the trailing conjunction', () => {
    expect(fighter.toolProficiencies).toEqual([]);
    expect(fighter.skillChoices).toEqual([
      {
        text: 'Choose two skills from Acrobatics, Animal Handling, Athletics, History, Insight, Intimidation, Perception, and Survival',
        choose: 2,
        from: [
          'Acrobatics',
          'Animal Handling',
          'Athletics',
          'History',
          'Insight',
          'Intimidation',
          'Perception',
          'Survival',
        ],
      },
    ]);
  });
});
