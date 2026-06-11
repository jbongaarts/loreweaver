/**
 * Subclass parser unit tests for the D&D 5e SRD 5.1 importer.
 *
 * Subclass excerpts in this file are reproduced from the System Reference
 * Document 5.1 by Wizards of the Coast LLC, available under the Creative
 * Commons Attribution 4.0 International License (CC-BY-4.0). Excerpts are used
 * as parser test input; no modification has been made beyond reformatting to
 * match the importer's extracted-line input shape, and bodies are trimmed to a
 * representative paragraph or two.
 *
 * Scope per ADR 0009 / loreweaver-0m9.5.17: subclasses only. The cases cover a
 * martial subclass (Champion → Fighter) and a caster subclass (Life Domain →
 * Cleric), the parent-boundary behavior across two classes in one slice, and
 * the fail-closed path for a known subclass heading with no body.
 */

import { describe, expect, it } from 'vitest';
import { parseSubclasses } from '../../../scripts/importers/dnd5e-srd-5.1/parseSubclasses.js';
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
// Fighter → Champion: a martial subclass. The slice mirrors the SRD shape: the
// base-class name and its Class Features precede the "Martial Archetypes" intro
// and the "Champion" subclass heading.
//
// This fixture is uniform-font (no `lineHeights`), so it exercises the
// FALLBACK path: with no tier signal the parser cannot tell where the overview
// ends and the first feature begins, so it conservatively keeps the following
// prose inline. The real SRD import is multi-tier and bounds the overview at
// the first feature heading — see the tiered Champion / Circle of the Land
// regressions below (eshyra-4a7.2).
// ---------------------------------------------------------------------------

const FIGHTER_WITH_CHAMPION = page(72, [
  'Fighter',
  'Class Features',
  'Hit Dice: 1d10 per fighter level',
  'Armor: All armor, shields',
  'Weapons: Simple weapons, martial weapons',
  'Saving Throws: Strength, Constitution',
  'Martial Archetypes',
  'Different fighters choose different approaches to perfecting their martial',
  'prowess. The martial archetype you choose to emulate reflects your approach.',
  'Champion',
  'The archetypal Champion focuses on the development of raw physical power',
  'honed to deadly perfection.',
  'Improved Critical',
  'Beginning when you choose this archetype at 3rd level, your weapon attacks',
  'score a critical hit on a roll of 19 or 20.',
]);

describe('parseSubclasses — Champion (martial subclass)', () => {
  const [champion] = parseSubclasses([FIGHTER_WITH_CHAMPION]);

  it('extracts the subclass by its exact heading name', () => {
    expect(champion.name).toBe('Champion');
  });

  it('links the subclass to its parent base class', () => {
    expect(champion.parentClass).toBe('Fighter');
  });

  it('captures the subclass overview prose (uniform-font fallback keeps following text inline)', () => {
    expect(champion.description).toMatch(/archetypal Champion focuses/);
    // No tier signal in this uniform fixture, so the conservative fallback
    // retains the trailing feature text. The tiered regression below proves
    // the real (multi-tier) import excludes it.
    expect(champion.description).toMatch(/Improved Critical/);
    expect(champion.description).toMatch(/critical hit on a roll of 19 or 20/);
  });

  it('does not absorb the base-class proficiency lines that precede it', () => {
    expect(champion.description).not.toMatch(/Hit Dice/);
    expect(champion.description).not.toMatch(/Saving Throws/);
  });

  it('records the source page of the subclass heading', () => {
    expect(champion.sourcePage).toBe(72);
  });
});

// ---------------------------------------------------------------------------
// Cleric → Life Domain: a caster subclass (a divine domain).
// ---------------------------------------------------------------------------

const CLERIC_WITH_LIFE_DOMAIN = page(58, [
  'Cleric',
  'Class Features',
  'Hit Dice: 1d8 per cleric level',
  'Armor: Light armor, medium armor, shields',
  'Weapons: Simple weapons',
  'Saving Throws: Wisdom, Charisma',
  'Divine Domains',
  'Each domain is detailed at the end of the class description.',
  'Life Domain',
  'The Life domain focuses on the vibrant positive energy that sustains all life.',
  'Bonus Proficiency',
  'When you choose this domain at 1st level, you gain proficiency with heavy armor.',
]);

describe('parseSubclasses — Life Domain (caster subclass)', () => {
  const [life] = parseSubclasses([CLERIC_WITH_LIFE_DOMAIN]);

  it('extracts the divine-domain subclass', () => {
    expect(life.name).toBe('Life Domain');
  });

  it('links it to the Cleric base class', () => {
    expect(life.parentClass).toBe('Cleric');
  });

  it('captures the domain body prose', () => {
    expect(life.description).toMatch(/vibrant positive energy/);
    expect(life.description).toMatch(/Bonus Proficiency/);
  });
});

// ---------------------------------------------------------------------------
// Wizard → School of Evocation: a "real-PDF-shaped" multi-word subclass
// heading. `extract.ts` joins column-spaced text items with no separator, so a
// multi-word heading can extract with internal tabs / runs of spaces. Explicit
// `\t` escapes and multi-space runs (rather than single spaces a formatter
// could normalize) keep the whitespace-normalization regression unambiguous:
// the parser must collapse internal whitespace before exact known-name match.
// ---------------------------------------------------------------------------

const WIZARD_WITH_EVOCATION = page(116, [
  'Wizard',
  'Class Features',
  'Hit\tDice: 1d6 per wizard level',
  'Armor: None',
  'Weapons: Daggers, darts, slings, quarterstaffs, light crossbows',
  'Saving\tThrows: Intelligence, Wisdom',
  'Arcane Traditions',
  'The study of wizardry is ancient, spanning entire schools of magic.',
  'School\tof   Evocation',
  'You have focused your study on magic that creates powerful elemental effects.',
  'Evocation Savant',
  'Beginning when you select this school at 2nd level, the gold and time you',
  'must spend to copy an evocation spell into your spellbook is halved.',
]);

describe('parseSubclasses — multi-word heading with internal whitespace', () => {
  const [evocation] = parseSubclasses([WIZARD_WITH_EVOCATION]);

  it('matches a heading whose internal whitespace differs from the known name', () => {
    expect(evocation.name).toBe('School of Evocation');
  });

  it('links it to the Wizard base class', () => {
    expect(evocation.parentClass).toBe('Wizard');
  });

  it('captures the school body prose', () => {
    expect(evocation.description).toMatch(/powerful elemental effects/);
    expect(evocation.description).toMatch(/Evocation Savant/);
  });
});

// ---------------------------------------------------------------------------
// Multiple classes in one slice — each subclass is bounded by the next class's
// name, sorted by name, with no cross-class bleed.
// ---------------------------------------------------------------------------

describe('parseSubclasses — multiple subclasses across classes', () => {
  const subclasses = parseSubclasses([
    FIGHTER_WITH_CHAMPION,
    CLERIC_WITH_LIFE_DOMAIN,
  ]);

  it('extracts every subclass in the slice, sorted by name', () => {
    expect(subclasses.map((s) => s.name)).toEqual(['Champion', 'Life Domain']);
  });

  it('keeps each subclass linked to the correct parent', () => {
    const byName = new Map(subclasses.map((s) => [s.name, s.parentClass]));
    expect(byName.get('Champion')).toBe('Fighter');
    expect(byName.get('Life Domain')).toBe('Cleric');
  });

  it("does not bleed the next class's content into the previous subclass", () => {
    const champion = subclasses.find((s) => s.name === 'Champion');
    expect(champion?.description).not.toMatch(/Cleric/);
    expect(champion?.description).not.toMatch(/Divine Domains/);
    expect(champion?.description).not.toMatch(/Life Domain/);
  });
});

// ---------------------------------------------------------------------------
// Real-PDF regression (loreweaver-9bu): the Barbarian progression table on
// the SRD 5.1 PDF has its level-20 capstone row "Primal Champion" column-
// wrapped so that "Champion" lands on its own extracted line — which is also
// the exact heading text of the Fighter subclass "Champion". A naive parser
// treats this stray line as a second Champion subclass heading and the pack
// writer then rejects the duplicate `subclass:champion` key. Boundary
// disambiguation: a subclass-name line is only a real heading when the
// current parent-class section matches the subclass's known parent. The
// slice begins AFTER the "Barbarian" chapter heading (consumed by the start
// anchor in sectionAnchors.classes), so the implicit current parent at the
// slice's leading content is Barbarian.
// ---------------------------------------------------------------------------

const BARBARIAN_THEN_FIGHTER_WITH_PRIMAL_COLUMN_WRAP = [
  page(8, [
    // Barbarian chapter content (its h=25.9 chapter heading was the slice's
    // start anchor, so the heading itself is excluded — the slice's leading
    // lines are implicitly Barbarian).
    'Class Features',
    'Hit Dice: 1d12 per barbarian level',
    'Armor: Light armor, medium armor, shields',
    'Weapons: Simple weapons, martial weapons',
    'Saving Throws: Strength, Constitution',
    'The Barbarian',
    'Level Proficiency Bonus Features',
    '1st +2 Rage, Unarmored Defense',
    '19th +6 Ability Score',
    'Improvement',
    // The "Primal Champion" capstone row column-wraps so "Champion" lands on
    // its own line — same exact text as the Fighter subclass heading.
    '20th +6 Primal Unlimited +4',
    'Champion',
    'Rage',
    'In battle, you fight with primal ferocity.',
    'Path of the Berserker',
    'For some barbarians, rage is a means to an end — that end being violence.',
    'Frenzy',
    'Starting when you choose this path at 3rd level, you can go into a frenzy.',
  ]),
  page(25, [
    'Fighter',
    'Class Features',
    'Hit Dice: 1d10 per fighter level',
    'Armor: All armor, shields',
    'Weapons: Simple weapons, martial weapons',
    'Saving Throws: Strength, Constitution',
    'Martial Archetypes',
    'Different fighters choose different approaches to perfecting their martial',
    'prowess. The martial archetype you choose to emulate reflects your approach.',
    'Champion',
    'The archetypal Champion focuses on the development of raw physical power',
    'honed to deadly perfection.',
    'Improved Critical',
    'Beginning when you choose this archetype at 3rd level, your weapon attacks',
    'score a critical hit on a roll of 19 or 20.',
  ]),
];

describe('parseSubclasses — "Primal Champion" column-wrap in Barbarian progression table', () => {
  const subs = parseSubclasses(BARBARIAN_THEN_FIGHTER_WITH_PRIMAL_COLUMN_WRAP);
  const champions = subs.filter((s) => s.name === 'Champion');

  it('emits exactly one Champion record despite the bare "Champion" line in the Barbarian section', () => {
    expect(champions).toHaveLength(1);
  });

  it('keeps the surviving Champion bound to the Fighter chapter', () => {
    expect(champions[0].parentClass).toBe('Fighter');
    expect(champions[0].sourcePage).toBe(25);
    expect(champions[0].description).toMatch(/archetypal Champion focuses/);
    expect(champions[0].description).toMatch(/Improved Critical/);
  });

  it('does not absorb Barbarian progression-table content into the Champion body', () => {
    expect(champions[0].description).not.toMatch(/Primal Unlimited/);
    expect(champions[0].description).not.toMatch(/primal ferocity/);
  });

  it('still extracts Path of the Berserker from the leading (implicit Barbarian) slice', () => {
    const berserker = subs.find((s) => s.name === 'Path of the Berserker');
    expect(berserker).toBeDefined();
    expect(berserker?.parentClass).toBe('Barbarian');
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

describe('parseSubclasses — body-font parent-class name inside a subclass table', () => {
  const [oath] = parseSubclasses([PALADIN_OATH_TABLE_REAL_PDF_SHAPE]);

  // Two regressions in one tiered fixture:
  //   1. The body-font "Paladin" cell (h=8.88) inside the Oath Spells table
  //      must not be mistaken for the parent-class chapter heading (which is
  //      h≈25.9) and truncate / misparent the subclass.
  //   2. The subclass description is bounded to its OVERVIEW: it stops at the
  //      first feature heading ("Oath Spells", h=12) so the feature bodies —
  //      Oath Spells, Aura of Devotion, Purity of Spirit, Holy Nimbus, which
  //      parseFeatures emits as their own records — do not bleed in
  //      (eshyra-4a7.2).
  it('parses Oath of Devotion and bounds its description to the overview', () => {
    expect(oath.name).toBe('Oath of Devotion');
    expect(oath.parentClass).toBe('Paladin');
    expect(oath.description).toContain(
      'binds a paladin to the loftiest ideals',
    );
  });

  it('does not swallow the subclass feature headings or bodies', () => {
    expect(oath.description).not.toContain('Oath Spells');
    expect(oath.description).not.toContain('Oath of Devotion Spells');
    expect(oath.description).not.toContain('Aura of Devotion');
    expect(oath.description).not.toContain('Holy Nimbus');
    expect(oath.description).not.toContain('emanate an aura of sunlight');
  });
});

// ---------------------------------------------------------------------------
// Tiered (real-PDF-shaped) bounded-overview regressions (eshyra-4a7.2). On the
// real SRD every subclass-granted feature heading renders at the leaf tier
// (h≈12.0) one step below the subclass name (h≈13.9); the subclass overview is
// body prose (h≈9.8) between them. The parser must end the subclass
// description at the first feature heading so the feature records (emitted by
// parseFeatures) are not duplicated inside the subclass blurb. These two cases
// are the boundary-bleed examples named in the bead.
// ---------------------------------------------------------------------------

const FIGHTER_CHAMPION_TIERED = tieredPage(25, [
  ['Fighter', 25.92],
  ['Class Features', 18],
  ['Hit Dice: 1d10 per fighter level', 9.84],
  ['Saving Throws: Strength, Constitution', 9.84],
  ['Martial Archetypes', 18],
  ['Different fighters choose different approaches.', 9.84],
  ['Champion', 13.92],
  ['The archetypal Champion focuses on the development of raw physical', 9.84],
  ['power honed to deadly perfection.', 9.84],
  ['Improved Critical', 12],
  ['Beginning when you choose this archetype at 3rd level, your weapon', 9.84],
  ['attacks score a critical hit on a roll of 19 or 20.', 9.84],
  ['Remarkable Athlete', 12],
  ['Starting at 7th level, you can add half your proficiency bonus.', 9.84],
  ['Monk', 25.92],
]);

describe('parseSubclasses — Champion overview bounded at first feature (tiered)', () => {
  const [champion] = parseSubclasses([FIGHTER_CHAMPION_TIERED]);

  it('keeps only the archetype overview prose', () => {
    expect(champion.name).toBe('Champion');
    expect(champion.parentClass).toBe('Fighter');
    expect(champion.description).toBe(
      'The archetypal Champion focuses on the development of raw physical power honed to deadly perfection.',
    );
  });

  it('does not include Improved Critical or later Champion feature bodies', () => {
    expect(champion.description).not.toMatch(/Improved Critical/);
    expect(champion.description).not.toMatch(
      /critical hit on a roll of 19 or 20/,
    );
    expect(champion.description).not.toMatch(/Remarkable Athlete/);
  });
});

const DRUID_CIRCLE_OF_THE_LAND_TIERED = tieredPage(21, [
  ['Druid', 25.92],
  ['Druid Circles', 18],
  ['The druidic circles are loose associations.', 9.84],
  ['Circle of the Land', 13.92],
  [
    'The Circle of the Land is made up of mystics and sages who safeguard',
    9.84,
  ],
  ['ancient knowledge and rites through a vast oral tradition.', 9.84],
  ['Bonus Cantrip', 12],
  ['When you choose this circle at 2nd level, you learn one additional', 9.84],
  ['druid cantrip of your choice.', 9.84],
  ['Natural Recovery', 12],
  ['Starting at 2nd level, you can regain some of your magical energy.', 9.84],
  ['Ranger', 25.92],
]);

describe('parseSubclasses — Circle of the Land overview bounded at first feature (tiered)', () => {
  const [circle] = parseSubclasses([DRUID_CIRCLE_OF_THE_LAND_TIERED]);

  it('keeps only the circle overview prose', () => {
    expect(circle.name).toBe('Circle of the Land');
    expect(circle.parentClass).toBe('Druid');
    expect(circle.description).toBe(
      'The Circle of the Land is made up of mystics and sages who safeguard ancient knowledge and rites through a vast oral tradition.',
    );
  });

  it('does not include Bonus Cantrip, Natural Recovery, or later feature bodies', () => {
    expect(circle.description).not.toMatch(/Bonus Cantrip/);
    expect(circle.description).not.toMatch(/Natural Recovery/);
    expect(circle.description).not.toMatch(
      /regain some of your magical energy/,
    );
  });
});

// ---------------------------------------------------------------------------
// Fail-closed + empty-slice behavior.
// ---------------------------------------------------------------------------

describe('parseSubclasses — fail closed / empty input', () => {
  it('throws when a known subclass heading has no body text', () => {
    const malformed = page(72, ['Fighter', 'Champion', 'Wizard']);
    expect(() => parseSubclasses([malformed])).toThrow(/no description text/);
  });

  it('returns an empty array when the slice contains no known subclass heading', () => {
    const noSubclasses = page(72, [
      'Classes',
      'This introductory prose names no subclass.',
    ]);
    expect(parseSubclasses([noSubclasses])).toEqual([]);
  });

  it('returns an empty array for an empty slice', () => {
    expect(parseSubclasses([])).toEqual([]);
  });
});
