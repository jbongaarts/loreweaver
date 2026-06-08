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

// ---------------------------------------------------------------------------
// Heading-boundary detection for subclass features whose headings the
// feature-start detector previously missed, so the heading + body were
// swallowed into the PRECEDING feature's record (eshyra-0m9.13). Three classes
// of miss, each reproduced from the SRD 5.1 source shape:
//   (1) a possessive heading printed with a curly apostrophe U+2019
//       ("Superior Hunter’s Defense", "Land’s Stride", "Thief’s Reflexes");
//   (2) a colon-qualified heading ("Channel Divinity: Preserve Life");
//   (3) a grant lead-in the level detector did not recognize
//       ("Also starting at 1st level …", "By 13th level …").
// Each fixture asserts the swallowed heading becomes its OWN record at its
// grant level AND that the preceding feature no longer absorbs its body.
// ---------------------------------------------------------------------------

const RANGER_HUNTER_CURLY_APOSTROPHE = page(36, [
  'Ranger',
  'Class Features',
  'Hit Dice: 1d10 per ranger level',
  'Armor: Light armor, medium armor, shields',
  'Weapons: Simple weapons, martial weapons',
  'Saving Throws: Strength, Dexterity',
  'Ranger Archetypes',
  'The ideal of the ranger archetype is realized in different ways.',
  'Hunter',
  'Emulating the Hunter archetype means accepting your place as a bulwark.',
  'Multiattack',
  'At 11th level, you gain one of the following features of your choice.',
  'Superior Hunter’s Defense',
  'At 15th level, you gain one of the following features of your choice.',
]);

describe('parseFeatures — curly-apostrophe subclass heading (Superior Hunter’s Defense)', () => {
  const features = parseFeatures([RANGER_HUNTER_CURLY_APOSTROPHE]);

  it('emits the curly-apostrophe heading as its own feature, not swallowed', () => {
    const byName = new Map(features.map((f) => [f.name, f]));
    expect(byName.has('Superior Hunter’s Defense')).toBe(true);
    const superior = byName.get('Superior Hunter’s Defense');
    expect(superior?.grantorKind).toBe('subclass');
    expect(superior?.grantorName).toBe('Hunter');
    expect(superior?.level).toBe(15);
  });

  it('does not absorb the swallowed heading into the preceding Multiattack body', () => {
    const byName = new Map(features.map((f) => [f.name, f]));
    expect(byName.get('Multiattack')?.description).not.toMatch(
      /Superior Hunter|15th level/,
    );
  });
});

const CLERIC_LIFE_DOMAIN_COLON_AND_LEADIN = page(58, [
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
  'Bonus Proficiency',
  'When you choose this domain at 1st level, you gain proficiency with heavy armor.',
  'Disciple of Life',
  'Also starting at 1st level, your healing spells are more effective.',
  'Channel Divinity: Preserve Life',
  'Starting at 2nd level, you can use your Channel Divinity to heal the badly injured.',
]);

describe('parseFeatures — colon heading and "Also starting at" lead-in (Life Domain)', () => {
  const features = parseFeatures([CLERIC_LIFE_DOMAIN_COLON_AND_LEADIN]);
  const byName = new Map(features.map((f) => [f.name, f]));

  it('emits the "Also starting at" feature as its own record (Disciple of Life)', () => {
    const disciple = byName.get('Disciple of Life');
    expect(disciple).toBeDefined();
    expect(disciple?.grantorKind).toBe('subclass');
    expect(disciple?.grantorName).toBe('Life Domain');
    expect(disciple?.level).toBe(1);
  });

  it('emits the colon-qualified Channel Divinity option as its own record', () => {
    const preserve = byName.get('Channel Divinity: Preserve Life');
    expect(preserve).toBeDefined();
    expect(preserve?.grantorName).toBe('Life Domain');
    expect(preserve?.level).toBe(2);
  });

  it('does not let Bonus Proficiency absorb the later features', () => {
    expect(byName.get('Bonus Proficiency')?.description).not.toMatch(
      /Disciple of Life|Preserve Life|Channel Divinity/,
    );
  });
});

const ROGUE_THIEF_BY_LEVEL_LEADIN = page(40, [
  'Rogue',
  'Class Features',
  'Hit Dice: 1d8 per rogue level',
  'Armor: Light armor',
  'Weapons: Simple weapons, hand crossbows, longswords, rapiers, shortswords',
  'Saving Throws: Dexterity, Intelligence',
  'Roguish Archetypes',
  'Rogues have many features in common.',
  'Thief',
  'You hone your skills in the larcenous arts of stealth and agility.',
  'Supreme Sneak',
  'Starting at 9th level, you have advantage on a Dexterity (Stealth) check.',
  'Use Magic Device',
  'By 13th level, you have learned enough about the workings of magic.',
  'Thief’s Reflexes',
  'When you reach 17th level, you have become adept at laying ambushes.',
]);

describe('parseFeatures — "By Nth level" lead-in and curly apostrophe (Thief)', () => {
  const features = parseFeatures([ROGUE_THIEF_BY_LEVEL_LEADIN]);
  const byName = new Map(features.map((f) => [f.name, f]));

  it('emits the "By 13th level" feature as its own record (Use Magic Device)', () => {
    const device = byName.get('Use Magic Device');
    expect(device).toBeDefined();
    expect(device?.grantorName).toBe('Thief');
    expect(device?.level).toBe(13);
  });

  it('emits the curly-apostrophe Thief’s Reflexes as its own record', () => {
    const reflexes = byName.get('Thief’s Reflexes');
    expect(reflexes).toBeDefined();
    expect(reflexes?.level).toBe(17);
  });

  it('does not let Supreme Sneak absorb the later features', () => {
    expect(byName.get('Supreme Sneak')?.description).not.toMatch(
      /Use Magic Device|Thief’s Reflexes|13th level|17th level/,
    );
  });
});

const DRUID_CIRCLE_OF_THE_LAND_LATER = page(20, [
  'Druid',
  'Class Features',
  'Hit Dice: 1d8 per druid level',
  'Armor: Light armor, medium armor, shields',
  'Weapons: Clubs, daggers, darts, javelins, maces',
  'Saving Throws: Intelligence, Wisdom',
  'Druid Circles',
  'Druids meet often to discuss the natural order.',
  'Circle of the Land',
  'The Circle of the Land is made up of mystics and sages.',
  'Natural Recovery',
  'Starting at 2nd level, you can regain some of your magical energy.',
  'Circle Spells',
  'Your mystical connection to the land infuses you with the ability to cast certain spells.',
  'At 3rd, 5th, 7th, and 9th level you gain access to circle spells connected to the land.',
  'Land’s Stride',
  'Starting at 6th level, moving through nonmagical difficult terrain costs you no extra movement.',
  'Nature’s Ward',
  'When you reach 10th level, you can’t be charmed or frightened by elementals or fey.',
  'Nature’s Sanctuary',
  'When you reach 14th level, creatures of the natural world become hesitant to attack you.',
]);

describe('parseFeatures — later Circle of the Land features are not skipped', () => {
  const features = parseFeatures([DRUID_CIRCLE_OF_THE_LAND_LATER]);
  const byName = new Map(features.map((f) => [f.name, f]));

  it('emits Circle Spells at its first grant level from a second-sentence enumeration', () => {
    // The grant clause is the SECOND sentence and enumerates several levels
    // ("At 3rd, 5th, 7th, and 9th level"); the grant level is the FIRST (3).
    const circleSpells = byName.get('Circle Spells');
    expect(circleSpells).toBeDefined();
    expect(circleSpells?.grantorName).toBe('Circle of the Land');
    expect(circleSpells?.level).toBe(3);
  });

  it('emits Land’s Stride, Nature’s Ward, and Nature’s Sanctuary at their grant levels', () => {
    expect(byName.get('Land’s Stride')?.level).toBe(6);
    expect(byName.get('Nature’s Ward')?.level).toBe(10);
    expect(byName.get('Nature’s Sanctuary')?.level).toBe(14);
    for (const name of [
      'Land’s Stride',
      'Nature’s Ward',
      'Nature’s Sanctuary',
    ]) {
      expect(byName.get(name)?.grantorName).toBe('Circle of the Land');
    }
  });

  it('does not let Natural Recovery absorb the later subclass features', () => {
    expect(byName.get('Natural Recovery')?.description).not.toMatch(
      /Land’s Stride|Nature’s Ward|Nature’s Sanctuary/,
    );
  });
});

// ---------------------------------------------------------------------------
// Repeated-use feature naming and earliest-grant level (eshyra-0m9.14).
//
// The SRD class progression tables wrap a single table cell across two
// extracted lines when the feature text is too wide for the column. The
// continuation line carries the rest of the cell (a wrapped word, or a
// repeated-use parenthetical such as "Indomitable (three uses)"). The parser
// must stitch the continuation back onto its row so that (a) a repeated-use
// feature keeps its canonical base name and its EARLIEST grant level, and
// (b) the wrapped fragment is never mistaken for a standalone feature heading.
//
// Excerpts reproduced from SRD 5.1 (CC-BY-4.0); reformatted to the importer's
// extracted-line shape, with the column wrap preserved as separate lines.
// ---------------------------------------------------------------------------

const FIGHTER_INDOMITABLE_REPEATED = page(74, [
  'Fighter',
  'The Fighter',
  'Level Proficiency Bonus Features',
  '1st +2 Fighting Style, Second Wind',
  '2nd +2 Action Surge (one use)',
  '9th +4 Indomitable (one use)',
  '13th +5 Indomitable (two uses)',
  '17th +6 Action Surge (two uses),',
  'Indomitable (three uses)',
  '18th +6 Martial Archetype feature',
  'Class Features',
  'Hit Dice: 1d10 per fighter level',
  'Saving Throws: Strength, Constitution',
  'Indomitable',
  'Beginning at 9th level, you can reroll a saving throw that you fail. If',
  'you do so, you must use the new roll, and you can’t use this feature again',
  'until you finish a long rest.',
  'You can use this feature twice between long rests starting at 13th level',
  'and three times between long rests starting at 17th level.',
]);

describe('parseFeatures — repeated-use feature keeps its canonical name and earliest level', () => {
  const features = parseFeatures([FIGHTER_INDOMITABLE_REPEATED]);
  const indomitable = features.filter((f) => /^Indomitable/.test(f.name));

  it('emits a single Indomitable record named for the canonical heading', () => {
    expect(indomitable).toHaveLength(1);
    expect(indomitable[0]?.name).toBe('Indomitable');
    expect(indomitable[0]?.grantorKind).toBe('class');
    expect(indomitable[0]?.grantorName).toBe('Fighter');
  });

  it('never adopts a later repeated-use parenthetical as the feature name', () => {
    expect(features.map((f) => f.name)).not.toContain(
      'Indomitable (three uses)',
    );
    expect(features.some((f) => /\((?:two|three) uses\)/.test(f.name))).toBe(
      false,
    );
  });

  it('records the earliest grant level (9), not a later repeated-use row', () => {
    expect(indomitable[0]?.level).toBe(9);
  });

  it('preserves the usage progression in the feature body', () => {
    expect(indomitable[0]?.description).toMatch(/twice between long rests/);
    expect(indomitable[0]?.description).toMatch(/three times/);
  });
});

const DRUID_ASI_WRAPPED_FIRST_ROW = page(76, [
  'Druid',
  'The Druid',
  'Level Proficiency Bonus Features',
  '1st +2 Druidic, Spellcasting',
  '2nd +2 Wild Shape, Druid Circle',
  '4th +2 Wild Shape improvement, Ability Score',
  'Improvement',
  '8th +3 Wild Shape improvement, Ability Score',
  'Improvement',
  '12th +4 Ability Score Improvement',
  '16th +5 Ability Score Improvement',
  'Class Features',
  'Hit Dice: 1d8 per druid level',
  'Saving Throws: Intelligence, Wisdom',
  'Ability Score Improvement',
  'When you reach 4th level, and again at 8th, 12th, 16th, and 19th level,',
  'you can increase one ability score of your choice by 2.',
]);

describe('parseFeatures — repeated feature takes its earliest table row when the first row wraps', () => {
  const features = parseFeatures([DRUID_ASI_WRAPPED_FIRST_ROW]);
  const asi = features.find((f) => f.name === 'Ability Score Improvement');

  it('extracts the feature and links it to the base class', () => {
    expect(asi).toBeDefined();
    expect(asi?.grantorKind).toBe('class');
    expect(asi?.grantorName).toBe('Druid');
  });

  it('reads the earliest grant level (4) even though the 4th-level cell wraps', () => {
    expect(asi?.level).toBe(4);
  });
});

const BARD_MAGICAL_SECRETS_WRAPPED = page(78, [
  'Bard',
  'The Bard',
  'Level Proficiency Bonus Features',
  '1st +2 Spellcasting, Bardic Inspiration',
  '(d6)',
  '10th +4 Bardic Inspiration (d10),',
  'Expertise, Magical Secrets',
  '14th +5 Magical Secrets, Bard College',
  'feature',
  '18th +6 Magical Secrets',
  'Class Features',
  'Hit Dice: 1d8 per bard level',
  'Saving Throws: Dexterity, Charisma',
  'Magical Secrets',
  'By 10th level, you have plundered magical knowledge from a wide spectrum',
  'of disciplines.',
]);

describe('parseFeatures — Magical Secrets uses its earliest (wrapped) grant row', () => {
  const features = parseFeatures([BARD_MAGICAL_SECRETS_WRAPPED]);
  const secrets = features.find((f) => f.name === 'Magical Secrets');

  it('extracts the feature and links it to the base class', () => {
    expect(secrets).toBeDefined();
    expect(secrets?.grantorName).toBe('Bard');
  });

  it('reads the earliest grant level (10) from the wrapped 10th-level row', () => {
    expect(secrets?.level).toBe(10);
  });
});
