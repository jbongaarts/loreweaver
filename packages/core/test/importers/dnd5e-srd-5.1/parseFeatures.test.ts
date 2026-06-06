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

// ---------------------------------------------------------------------------
// Simple class feature: Second Wind (Fighter). Its SRD prose carries no level
// — the grant level comes from the class progression table rather than a
// default.
// ---------------------------------------------------------------------------

const FIGHTER_SECOND_WIND = page(72, [
  'Fighter',
  'The Fighter',
  'Level Proficiency Bonus Features',
  '1st +2 Fighting Style, Second Wind',
  '2nd +2 Action Surge',
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

  it('reads level 1 from the progression table', () => {
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

const FIGHTER_NO_TABLE_SECOND_WIND = page(72, [
  'Fighter',
  'Class Features',
  'Hit Dice: 1d10 per fighter level',
  'Armor: All armor, shields',
  'Weapons: Simple weapons, martial weapons',
  'Saving Throws: Strength, Constitution',
  'Second Wind',
  'You have a limited well of stamina that you can draw on to protect',
  'yourself from harm.',
]);

describe('parseFeatures — no unsafe default level without a table', () => {
  it('does not emit a no-leadin class feature when the progression table is absent', () => {
    expect(parseFeatures([FIGHTER_NO_TABLE_SECOND_WIND])).toEqual([]);
  });
});

const FIGHTER_TABLE_ACTION_SURGE = page(72, [
  'Fighter',
  'The Fighter',
  'Level Proficiency Bonus Features',
  '1st +2 Fighting Style, Second Wind',
  '2nd +2 Action Surge',
  'Class Features',
  'Hit Dice: 1d10 per fighter level',
  'Armor: All armor, shields',
  'Weapons: Simple weapons, martial weapons',
  'Saving Throws: Strength, Constitution',
  'Action Surge',
  'You can push yourself beyond your normal limits for a moment.',
]);

describe('parseFeatures — table-driven class feature level', () => {
  const [actionSurge] = parseFeatures([FIGHTER_TABLE_ACTION_SURGE]);

  it('uses the progression table when class feature prose has no level lead-in', () => {
    expect(actionSurge.name).toBe('Action Surge');
    expect(actionSurge.grantorKind).toBe('class');
    expect(actionSurge.grantorName).toBe('Fighter');
    expect(actionSurge.level).toBe(2);
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
  'The Barbarian',
  'Level Proficiency Bonus Features Rages Rage Damage',
  '1st +2 Rage, Unarmored Defense 2 +2',
  '2nd +2 Reckless Attack, Danger Sense 2 +2',
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
  'The Wizard',
  'Level Proficiency Bonus Features Cantrips Known Spells Known',
  '1st +2 Spellcasting, Arcane Recovery 3 6',
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

const FIGHTER_FIGHTING_STYLE_OPTIONS = page(72, [
  'Fighter',
  'The Fighter',
  'Level Proficiency Bonus Features',
  '1st +2 Fighting Style, Second Wind',
  'Class Features',
  'Hit Dice: 1d10 per fighter level',
  'Armor: All armor, shields',
  'Weapons: Simple weapons, martial weapons',
  'Saving Throws: Strength, Constitution',
  'Fighting Style',
  'You adopt a particular style of fighting as your specialty. Choose one',
  'of the following options. You can’t take a Fighting Style option more',
  'than once, even if you later get to choose again.',
  'Archery',
  'You gain a +2 bonus to attack rolls you make with ranged weapons.',
  'Defense',
  'While you are wearing armor, you gain a +1 bonus to AC.',
]);

describe('parseFeatures — title-case option subheadings', () => {
  const features = parseFeatures([FIGHTER_FIGHTING_STYLE_OPTIONS]);

  it('keeps option headings inside the parent feature body', () => {
    expect(features.map((f) => f.name)).toEqual(['Fighting Style']);
    expect(features[0]?.description).toMatch(/Archery/);
    expect(features[0]?.description).toMatch(/Defense/);
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
    'The Fighter',
    'Level Proficiency Bonus Features',
    '1st +2 Fighting Style, Second Wind',
    '2nd +2 Action Surge',
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
// Real-PDF regression: a feature whose body contains an in-body reference
// table titled with the SAME feature name (e.g. Cleric's "Destroy Undead"
// feature, whose body ends with a "Destroy Undead" CR-threshold table). The
// table caption is heading-shaped and matches the same progression-table
// anchor, so a naive parser emits the feature twice (loreweaver-8gp).
// ---------------------------------------------------------------------------

const CLERIC_DESTROY_UNDEAD = page(58, [
  'Cleric',
  'The Cleric',
  'Level Proficiency Bonus Features',
  '1st +2 Spellcasting, Divine Domain',
  '2nd +2 Channel Divinity (1/rest), Divine Domain',
  '5th +3 Destroy Undead (CR 1/2)',
  '8th +3 Ability Score Improvement, Destroy Undead',
  'Class Features',
  'Hit Dice: 1d8 per cleric level',
  'Armor: Light armor, medium armor, shields',
  'Weapons: Simple weapons',
  'Saving Throws: Wisdom, Charisma',
  'Destroy Undead',
  'Starting at 5th level, when an undead fails its saving',
  'throw against your Turn Undead feature, the',
  'creature is instantly destroyed if its challenge rating',
  'is at or below a certain threshold, as shown in the',
  'Destroy Undead table.',
  'Destroy Undead',
  'Cleric Level Destroys Undead of CR . . .',
  '5th 1/2 or lower',
  '8th 1 or lower',
]);

describe('parseFeatures — same-name in-body reference table (Destroy Undead)', () => {
  const features = parseFeatures([CLERIC_DESTROY_UNDEAD]);

  it('emits exactly one Destroy Undead record despite the in-body table caption', () => {
    const destroyUndead = features.filter((f) => f.name === 'Destroy Undead');
    expect(destroyUndead).toHaveLength(1);
  });

  it('records the grant level from the progression table (earliest row)', () => {
    const [destroyUndead] = features.filter((f) => f.name === 'Destroy Undead');
    expect(destroyUndead.grantorKind).toBe('class');
    expect(destroyUndead.grantorName).toBe('Cleric');
    expect(destroyUndead.level).toBe(5);
  });

  it('keeps the table contents inside the feature body', () => {
    const [destroyUndead] = features.filter((f) => f.name === 'Destroy Undead');
    expect(destroyUndead.description).toMatch(/challenge rating/);
    expect(destroyUndead.description).toMatch(/Cleric Level/);
  });
});

// ---------------------------------------------------------------------------
// Real-PDF regression: a feature whose option list is printed at the end of
// the class chapter under a SECOND heading that re-states the feature name
// (e.g. Warlock's "Eldritch Invocations" — granted at level 2, with the
// per-invocation options listed at the end of the class chapter under a
// second "Eldritch Invocations" heading). The repeat is not inside the
// original feature's body (other features intervene), so the parser must
// merge at output time rather than rely on body-level suppression.
// ---------------------------------------------------------------------------

const WARLOCK_ELDRITCH_INVOCATIONS = page(46, [
  'Warlock',
  'The Warlock',
  'Level Proficiency Bonus Features',
  '1st +2 Otherworldly Patron, Pact Magic',
  '2nd +2 Eldritch Invocations',
  '3rd +2 Pact Boon',
  '20th +6 Eldritch Master',
  'Class Features',
  'Hit Dice: 1d8 per warlock level',
  'Armor: Light armor',
  'Weapons: Simple weapons',
  'Saving Throws: Wisdom, Charisma',
  'Eldritch Invocations',
  'In your study of occult lore, you have unearthed eldritch invocations,',
  'fragments of forbidden knowledge.',
  'Eldritch Master',
  'At 20th level, you can draw on your inner reserve of mystical power.',
  'Eldritch Invocations',
  'If an eldritch invocation has prerequisites, you must meet them to learn it.',
  'Agonizing Blast',
  'When you cast eldritch blast, add your Charisma modifier to the damage.',
]);

describe('parseFeatures — end-of-chapter option list re-uses the feature heading (Eldritch Invocations)', () => {
  const features = parseFeatures([WARLOCK_ELDRITCH_INVOCATIONS]);

  it('emits exactly one Eldritch Invocations record despite the option-list heading', () => {
    const eldritch = features.filter((f) => f.name === 'Eldritch Invocations');
    expect(eldritch).toHaveLength(1);
  });

  it('keeps the grant level from the progression table', () => {
    const [eldritch] = features.filter(
      (f) => f.name === 'Eldritch Invocations',
    );
    expect(eldritch.grantorKind).toBe('class');
    expect(eldritch.grantorName).toBe('Warlock');
    expect(eldritch.level).toBe(2);
  });

  it('merges the option-list body into the feature description', () => {
    const [eldritch] = features.filter(
      (f) => f.name === 'Eldritch Invocations',
    );
    expect(eldritch.description).toMatch(/study of occult lore/);
    expect(eldritch.description).toMatch(/prerequisites/);
    expect(eldritch.description).toMatch(/Agonizing Blast/);
  });

  it('still emits the intervening feature between the two heading occurrences', () => {
    expect(features.map((f) => f.name)).toContain('Eldritch Master');
  });
});

const BARBARIAN_BERSERKER_REAL_PDF_SHAPE = [
  tieredPage(8, [
    ['Class Features', 13.92],
    ['The Barbarian', 12],
    ['Level Proficiency Bonus Features', 8.88],
    ['1st +2 Rage, Unarmored Defense', 8.88],
    ['20th +6 Primal Unlimited +4', 8.88],
    ['Champion', 8.88],
    ['Rage', 13.92],
    ['In battle, you fight with primal ferocity.', 9.84],
  ]),
  tieredPage(9, [
    ['Path of the Berserker', 13.92],
    ['For some barbarians, rage is a means to an end.', 9.84],
    ['Frenzy', 12],
    [
      'Starting when you choose this path at 3rd level, you can go into a frenzy.',
      9.84,
    ],
  ]),
  tieredPage(10, [
    ['Mindless Rage', 12],
    [
      'Beginning at 6th level, you cannot be charmed or frightened while raging.',
      9.84,
    ],
    ['Intimidating Presence', 12],
    [
      'Beginning at 10th level, you can use your action to frighten someone.',
      9.84,
    ],
    ['Retaliation', 12],
    ['Starting at 14th level, you can strike back at a nearby attacker.', 9.84],
    ['Bard', 25.92],
  ]),
];

describe('parseFeatures — first sliced class and Path of the Berserker', () => {
  const features = parseFeatures(BARBARIAN_BERSERKER_REAL_PDF_SHAPE);
  const berserkerFeatures = features.filter(
    (feature) => feature.grantorName === 'Path of the Berserker',
  );

  it('keeps the implicit opening class context after the Barbarian heading is sliced away', () => {
    expect(
      berserkerFeatures.map(({ name, level }) => ({ name, level })),
    ).toEqual([
      { name: 'Frenzy', level: 3 },
      { name: 'Intimidating Presence', level: 10 },
      { name: 'Mindless Rage', level: 6 },
      { name: 'Retaliation', level: 14 },
    ]);
  });

  it('does not treat the body-font Champion table fragment as a Barbarian subclass', () => {
    expect(
      features.filter((feature) => feature.grantorName === 'Champion'),
    ).toEqual([]);
  });
});

const PALADIN_OATH_TABLE_REAL_PDF_SHAPE = tieredPage(33, [
  ['Paladin', 25.92],
  ['Sacred Oaths', 13.92],
  ['Oath of Devotion', 13.92],
  ['The Oath of Devotion binds a paladin to the loftiest ideals.', 9.84],
  ['Oath Spells', 12],
  ['You gain oath spells at the paladin levels listed.', 9.84],
  ['Oath of Devotion Spells', 12],
  ['Paladin', 8.88],
  ['Level Spells', 8.88],
  ['3rd protection from evil and good, sanctuary', 8.88],
  ['Aura of Devotion', 12],
  ['Starting at 7th level, nearby allies cannot be charmed.', 9.84],
  ['Purity of Spirit', 12],
  [
    'Beginning at 15th level, you are always protected from evil and good.',
    9.84,
  ],
  ['Holy Nimbus', 12],
  ['At 20th level, you can emanate an aura of sunlight.', 9.84],
  ['Ranger', 25.92],
]);

describe('parseFeatures — body-font parent-class name inside a subclass table', () => {
  const features = parseFeatures([PALADIN_OATH_TABLE_REAL_PDF_SHAPE]);

  it('keeps post-table oath features attributed to Oath of Devotion', () => {
    const oathFeatures = features
      .filter((feature) =>
        ['Aura of Devotion', 'Purity of Spirit', 'Holy Nimbus'].includes(
          feature.name,
        ),
      )
      .map(({ name, grantorKind, grantorName, level }) => ({
        name,
        grantorKind,
        grantorName,
        level,
      }));

    expect(oathFeatures).toEqual([
      {
        name: 'Aura of Devotion',
        grantorKind: 'subclass',
        grantorName: 'Oath of Devotion',
        level: 7,
      },
      {
        name: 'Holy Nimbus',
        grantorKind: 'subclass',
        grantorName: 'Oath of Devotion',
        level: 20,
      },
      {
        name: 'Purity of Spirit',
        grantorKind: 'subclass',
        grantorName: 'Oath of Devotion',
        level: 15,
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed + empty input.
// ---------------------------------------------------------------------------

describe('parseFeatures — fail closed / empty input', () => {
  it('throws when a detected feature heading has no body text', () => {
    const malformed = page(72, [
      'Fighter',
      'The Fighter',
      'Level Proficiency Bonus Features',
      '1st +2 Second Wind',
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
