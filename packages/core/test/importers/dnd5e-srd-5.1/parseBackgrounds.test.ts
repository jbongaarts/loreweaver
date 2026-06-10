/**
 * Background-parser unit tests for the D&D 5e SRD 5.1 importer
 * (eshyra-0m9.17).
 *
 * Background text excerpts in this file are reproduced from the System
 * Reference Document 5.1 by Wizards of the Coast LLC, available under the
 * Creative Commons Attribution 4.0 International License (CC-BY-4.0). Excerpts
 * are used as parser test input; no modification has been made beyond
 * reformatting to match the importer's extracted-line input shape.
 */

import { describe, expect, it } from 'vitest';
import { parseBackgrounds } from '../../../scripts/importers/dnd5e-srd-5.1/parseBackgrounds.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

/**
 * Heights-aware page builder: every line gets the supplied per-line height so
 * the parser exercises its heading-hierarchy mode (the real SRD extraction).
 */
function tieredPage(
  pageNumber: number,
  entries: ReadonlyArray<readonly [text: string, height: number]>,
): PageText {
  return {
    pageNumber,
    lines: entries.map(([text]) => text),
    lineHeights: entries.map(([, height]) => height),
  };
}

// Real SRD 5.1 font tiers: entry heading h≈13.9, leaf headings (Feature: /
// Suggested Characteristics) h≈12.0, body prose h≈9.8, roll-table text h≈8.9.
const ENTRY_H = 13.9;
const LEAF_H = 12.0;
const BODY_H = 9.8;
const TABLE_H = 8.9;

// Chapter-intro region the orchestrator carves OFF before background parsing,
// included here to prove the parser never promotes intro sections to entries
// even when fed the whole chapter slice.
const INTRO_TIERED: ReadonlyArray<readonly [string, number]> = [
  ['Every story has a beginning. Your character’s', BODY_H],
  ['background reveals where you came from.', BODY_H],
  ['Proficiencies', LEAF_H],
  ['Each background gives a character proficiency in', BODY_H],
  ['two skills.', BODY_H],
  ['Customizing a Background', LEAF_H],
  ['You might want to tweak some of the features of a', BODY_H],
  ['background.', BODY_H],
];

const ACOLYTE_TIERED: ReadonlyArray<readonly [string, number]> = [
  ['Acolyte', ENTRY_H],
  ['You have spent your life in the service of a temple to', BODY_H],
  ['a specific god or pantheon of gods. You are not necessarily a', BODY_H],
  ['cleric—performing sacred rites is not the same thing', BODY_H],
  ['as channeling divine power.', BODY_H],
  ['Skill Proficiencies: Insight, Religion', BODY_H],
  ['Languages: Two of your choice', BODY_H],
  ['Equipment: A holy symbol (a gift to you when you', BODY_H],
  ['entered the priesthood), a prayer book or prayer', BODY_H],
  ['wheel, 5 sticks of incense, vestments, a set of', BODY_H],
  ['common clothes, and a pouch containing 15 gp', BODY_H],
  ['Feature: Shelter of the Faithful', LEAF_H],
  ['As an acolyte, you command the respect of those', BODY_H],
  ['who share your faith, and you can perform the', BODY_H],
  ['religious ceremonies of your deity.', BODY_H],
  ['Suggested Characteristics', LEAF_H],
  ['Acolytes are shaped by their experience in temples', BODY_H],
  ['or other religious communities.', BODY_H],
  ['d8 Personality Trait', TABLE_H],
  ['1 I idolize a particular hero of my faith, and constantly', TABLE_H],
  ['refer to that person’s deeds and example.', TABLE_H],
  ['2 I can find common ground between the fiercest', TABLE_H],
  ['enemies, empathizing with them and always', TABLE_H],
  ['working toward peace.', TABLE_H],
  ['3 Nothing can shake my optimistic attitude.', TABLE_H],
  ['d6 Ideal', TABLE_H],
  ['1 Tradition. The ancient traditions of worship and', TABLE_H],
  ['sacrifice must be preserved and upheld. (Lawful)', TABLE_H],
  ['2 Charity. I always try to help those in need, no matter', TABLE_H],
  ['what the personal cost. (Good)', TABLE_H],
  ['d6 Bond', TABLE_H],
  ['1 I would die to recover an ancient relic of my faith', TABLE_H],
  ['that was lost long ago.', TABLE_H],
  ['2 Everything I do is for the common people.', TABLE_H],
  ['d6 Flaw', TABLE_H],
  ['1 I judge others harshly, and myself even more', TABLE_H],
  ['severely.', TABLE_H],
  ['2 I am inflexible in my thinking.', TABLE_H],
];

describe('parseBackgrounds — heading-hierarchy mode (real SRD font tiers)', () => {
  const { backgrounds, characteristicTables } = parseBackgrounds([
    tieredPage(60, [...INTRO_TIERED, ...ACOLYTE_TIERED]),
  ]);

  it('extracts exactly one background and never promotes intro sections', () => {
    expect(backgrounds).toHaveLength(1);
    expect(backgrounds[0].name).toBe('Acolyte');
  });

  it('records the source page of the entry heading', () => {
    expect(backgrounds[0].sourcePage).toBe(60);
  });

  it('keeps the chapter-intro prose out of the description', () => {
    expect(backgrounds[0].description).toMatch(/^You have spent your life/);
    expect(backgrounds[0].description).not.toMatch(/Every story has a/);
    expect(backgrounds[0].description).not.toMatch(/Customizing/);
  });

  it('parses the labeled grant lines into structured fields', () => {
    expect(backgrounds[0].skillProficiencies).toEqual(['Insight', 'Religion']);
    expect(backgrounds[0].languages).toBe('Two of your choice');
    // The wrapped Equipment value re-joins across its four source lines.
    expect(backgrounds[0].equipment).toBe(
      'A holy symbol (a gift to you when you entered the priesthood), a prayer book or prayer wheel, 5 sticks of incense, vestments, a set of common clothes, and a pouch containing 15 gp',
    );
    // Acolyte grants no tool proficiencies; the field must be absent, not [].
    expect(backgrounds[0].toolProficiencies).toBeUndefined();
  });

  it('nests the background feature as { name, text }', () => {
    expect(backgrounds[0].feature.name).toBe('Shelter of the Faithful');
    expect(backgrounds[0].feature.text).toMatch(
      /^As an acolyte, you command the respect/,
    );
    // The Suggested Characteristics section must not bleed into the feature.
    expect(backgrounds[0].feature.text).not.toMatch(/shaped by their/);
  });

  it('keeps the Suggested Characteristics intro prose without table rows', () => {
    expect(backgrounds[0].suggestedCharacteristics).toMatch(
      /^Acolytes are shaped by their experience/,
    );
    expect(backgrounds[0].suggestedCharacteristics).not.toMatch(/idolize/);
  });

  it('emits the four roll tables with synthesized names and source columns', () => {
    expect(characteristicTables.map((t) => t.name)).toEqual([
      'Acolyte Bonds',
      'Acolyte Flaws',
      'Acolyte Ideals',
      'Acolyte Personality Traits',
    ]);
    const personality = characteristicTables.find(
      (t) => t.name === 'Acolyte Personality Traits',
    );
    expect(personality?.columns).toEqual(['d8', 'Personality Trait']);
  });

  it('re-joins wrapped roll-table rows onto their numbered row', () => {
    const personality = characteristicTables.find(
      (t) => t.name === 'Acolyte Personality Traits',
    );
    expect(personality?.rows).toEqual([
      [
        1,
        'I idolize a particular hero of my faith, and constantly refer to that person’s deeds and example.',
      ],
      [
        2,
        'I can find common ground between the fiercest enemies, empathizing with them and always working toward peace.',
      ],
      [3, 'Nothing can shake my optimistic attitude.'],
    ]);
  });

  it('keeps each roll table bounded at the next die header', () => {
    const ideals = characteristicTables.find(
      (t) => t.name === 'Acolyte Ideals',
    );
    expect(ideals?.rows).toEqual([
      [
        1,
        'Tradition. The ancient traditions of worship and sacrifice must be preserved and upheld. (Lawful)',
      ],
      [
        2,
        'Charity. I always try to help those in need, no matter what the personal cost. (Good)',
      ],
    ]);
    const flaws = characteristicTables.find((t) => t.name === 'Acolyte Flaws');
    expect(flaws?.rows).toEqual([
      [1, 'I judge others harshly, and myself even more severely.'],
      [2, 'I am inflexible in my thinking.'],
    ]);
  });
});

describe('parseBackgrounds — text-heuristic mode (uniform-font fixture)', () => {
  const lines = [
    'Customizing a Background',
    'You might want to tweak some of the features of a background.',
    '',
    'Acolyte',
    'You have spent your life in the service of a temple.',
    'Skill Proficiencies: Insight, Religion',
    'Languages: Two of your choice',
    'Equipment: A holy symbol, a prayer book or prayer',
    'wheel, and a pouch containing 15 gp',
    'Feature: Shelter of the Faithful',
    'As an acolyte, you command the respect of those who share your faith.',
    'Suggested Characteristics',
    'Acolytes are shaped by their experience in temples.',
    'd6 Ideal',
    '1 Tradition. The ancient traditions of worship must be upheld. (Lawful)',
    '2 Charity. I always try to help those in need. (Good)',
  ];
  const { backgrounds, characteristicTables } = parseBackgrounds([
    page(60, lines),
  ]);

  it('detects the entry by its Skill Proficiencies signature', () => {
    expect(backgrounds).toHaveLength(1);
    expect(backgrounds[0].name).toBe('Acolyte');
    // The intro heading has no grant block, so it is not an entry.
    expect(backgrounds.map((b) => b.name)).not.toContain(
      'Customizing a Background',
    );
  });

  it('parses fields and tables in heuristic mode too', () => {
    expect(backgrounds[0].skillProficiencies).toEqual(['Insight', 'Religion']);
    expect(backgrounds[0].equipment).toBe(
      'A holy symbol, a prayer book or prayer wheel, and a pouch containing 15 gp',
    );
    expect(backgrounds[0].feature.name).toBe('Shelter of the Faithful');
    expect(characteristicTables).toHaveLength(1);
    expect(characteristicTables[0].name).toBe('Acolyte Ideals');
    expect(characteristicTables[0].rows).toHaveLength(2);
  });
});

describe('parseBackgrounds — degraded inputs', () => {
  it('returns empty results for an empty slice', () => {
    expect(parseBackgrounds([])).toEqual({
      backgrounds: [],
      characteristicTables: [],
    });
  });

  it('does not emit an entry that lacks a Feature heading', () => {
    const { backgrounds } = parseBackgrounds([
      page(60, [
        'Acolyte',
        'You have spent your life in the service of a temple.',
        'Skill Proficiencies: Insight, Religion',
        'Suggested Characteristics',
        'Acolytes are shaped by their experience in temples.',
      ]),
    ]);
    expect(backgrounds).toEqual([]);
  });

  it('does not emit prose-only sections with no grant block', () => {
    const { backgrounds, characteristicTables } = parseBackgrounds([
      page(60, [
        'Proficiencies',
        'Each background gives a character proficiency in two skills.',
        '',
        'Languages',
        'Some backgrounds also allow characters to learn additional languages.',
      ]),
    ]);
    expect(backgrounds).toEqual([]);
    expect(characteristicTables).toEqual([]);
  });
});
