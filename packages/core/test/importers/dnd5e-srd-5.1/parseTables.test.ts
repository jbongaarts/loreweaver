/**
 * Reference-table parser unit tests for the D&D 5e SRD 5.1 importer.
 *
 * The Difficulty Classes excerpt is reproduced from the System Reference
 * Document 5.1 by Wizards of the Coast LLC, available under the Creative
 * Commons Attribution 4.0 International License (CC-BY-4.0), used as parser
 * test input with no modification beyond reformatting to the importer's
 * extracted-line input shape.
 *
 * The XP-threshold and treasure-table inputs are NOT drawn from the SRD 5.1
 * PDF — that source contains no such tables (see the importer README and
 * loreweaver-46m). They are synthetic fixtures shaped like the parser's
 * expected extracted lines, present only to exercise the multi-column and
 * column-block reconstruction paths that the SRD 5.1 source never triggers.
 */

import { describe, expect, it } from 'vitest';
import { parseTables } from '../../../scripts/importers/dnd5e-srd-5.1/parseTables.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

const DIFFICULTY_CLASSES_PAGE = page(77, [
  'Difficulty Classes',
  'Task Difficulty',
  'DC',
  'Very easy 5',
  'Easy 10',
  'Medium 15',
  'Hard 20',
  'Very hard 25',
  'Nearly impossible 30',
  '',
  'Using Each Ability',
  'Every task that a character or monster might attempt is covered by one of the six abilities.',
]);

// The two trap reference tables from the SRD 5.1 gamemastering "Traps" section
// (p196). Both are present in the vendored SRD 5.1 source and emitted into the
// canonical pack (loreweaver-hvp). En-dash ranges mirror the SRD typography.
const TRAP_TABLES_PAGE = page(196, [
  'Trap Save DCs and Attack Bonuses',
  'Trap Danger Save DC Attack Bonus',
  'Setback 10–11 +3 to +5',
  'Dangerous 12–15 +6 to +8',
  'Deadly 16–20 +9 to +12',
  'Damage Severity by Level',
  'Character Level Setback Dangerous Deadly',
  '1st–4th 1d10 2d10 4d10',
  '5th–10th 2d10 4d10 10d10',
  '11th–16th 4d10 10d10 18d10',
  '17th–20th 10d10 18d10 24d10',
  'Complex Traps',
  'Complex traps work like standard traps, except once activated they execute',
]);

const ENCOUNTER_THRESHOLDS_PAGE = page(84, [
  'XP Thresholds by Character Level',
  'Character Level',
  'Easy',
  'Medium',
  'Hard',
  'Deadly',
  '1st 25 50 75 100',
  '2nd 50 100 150 200',
  '3rd 75 150 225 400',
  '4th 125 250 375 500',
  '',
  'Challenge',
  'A monster challenge rating tells you how great a threat the monster is.',
]);

const INTERLEAVED_TREASURE_PAGE = page(136, [
  'Individual Treasure: Challenge 0-4',
  'd100',
  'CP',
  'SP',
  'EP',
  'GP',
  'PP',
  '01-30',
  '31-60',
  '61-70',
  '5d6 (17)',
  '-',
  '-',
  '-',
  '4d6 (14)',
  '-',
  '-',
  '-',
  '3d6 (10)',
  '-',
  '-',
  '-',
  '-',
  '-',
  '-',
  '',
  'Treasure Hoard: Challenge 0-4',
  'd100',
  'CP',
  'SP',
  'GP',
  'Gems or Art Objects',
  'Magic Items',
  '01-06',
  '07-16',
  '17-26',
  '6d6 x 100 (2,100)',
  '6d6 x 100 (2,100)',
  '6d6 x 100 (2,100)',
  '3d6 x 100 (1,050)',
  '3d6 x 100 (1,050)',
  '3d6 x 100 (1,050)',
  '2d6 x 10 (70)',
  '2d6 x 10 (70)',
  '2d6 x 10 (70)',
  '-',
  '2d6 (7) 10 gp gems',
  '2d4 (5) 25 gp art objects',
  '-',
  '-',
  'Table A',
]);

const INCOMPLETE_TREASURE_PAGE = page(137, [
  'Individual Treasure: Challenge 0-4',
  'd100',
  'CP',
  'SP',
  '01-50',
  '51-100',
  '5d6 (17)',
  '4d6 (14)',
  '3d6 (10)',
  'Using Magic Items',
  'A magic item is a rare and precious thing.',
]);

const MADNESS_TABLE_PAGES = [
  page(201, [
    'Short-Term Madness',
    'd100 Effect (lasts 1d10 minutes)',
    '01–20 The character retreats into his or her mind and',
    'becomes paralyzed. The effect ends if the',
    'character takes any damage.',
    '21–30 The character becomes incapacitated and',
    'spends the duration screaming, laughing, or',
    'weeping.',
    '31–40 The character becomes frightened and must',
    'use his or her action and movement each',
    'round to flee from the source of the fear.',
    '41–50 The character begins babbling and is incapable',
    'of normal speech or spellcasting.',
    '51–60 The character must use his or her action each',
    'round to attack the nearest creature.',
    '61–70 The character experiences vivid hallucinations',
    'and has disadvantage on ability checks.',
    '71–75 The character does whatever anyone tells him',
    'or her to do that isn’t obviously self-',
    'destructive.',
    '76–80 The character experiences an overpowering',
    'urge to eat something strange such as dirt,',
    'slime, or offal.',
    '81–90 The character is stunned.',
    '91–100 The character falls unconscious.',
    'Long-Term Madness',
    'd100 Effect (lasts 1d10 × 10 hours)',
    '01–10 The character feels compelled to repeat a',
    'specific activity over and over, such as washing',
    'hands, touching things, praying, or counting',
    'coins.',
    '11–20 The character experiences vivid hallucinations',
    'and has disadvantage on ability checks.',
    '21–30 The character suffers extreme paranoia. The',
    'character has disadvantage on Wisdom and',
    'Charisma checks.',
    '31–40 The character regards something (usually the',
    'source of madness) with intense revulsion, as if',
    'affected by the antipathy effect of the',
    'antipathy/sympathy spell.',
    '41–45 The character experiences a powerful delusion.',
    'Choose a potion. The character imagines that',
    'he or she is under its effects.',
    '46–55 The character becomes attached to a “lucky',
    'charm,” such as a person or an object, and has',
    'disadvantage on attack rolls, ability checks, and',
    'saving throws while more than 30 feet from it.',
    '56–65 The character is blinded (25%) or deafened',
    '(75%).',
    '66–75 The character experiences uncontrollable',
    'tremors or tics, which impose disadvantage on',
    'attack rolls, ability checks, and saving throws',
    'that involve Strength or Dexterity.',
    '76–85 The character suffers from partial amnesia. The',
    'character knows who he or she is and retains',
    'racial traits and class features, but doesn’t',
    'recognize other people or remember anything',
    'that happened before the madness took effect.',
    '86–90 Whenever the character takes damage, he or',
    'she must succeed on a DC 15 Wisdom saving',
    'throw or be affected as though he or she failed',
    'a saving throw against the confusion spell. The',
    'confusion effect lasts for 1 minute.',
    '91–95 The character loses the ability to speak.',
    '96–100 The character falls unconscious. No amount of',
    'jostling or damage can wake the character.',
  ]),
  page(202, [
    'Indefinite Madness',
    'd100 Flaw (lasts until cured)',
    '01–15 “Being drunk keeps me sane.”',
    '16–25 “I keep whatever I find.”',
    '26–30 “I try to become more like someone else I',
    'know—adopting his or her style of dress,',
    'mannerisms, and name.”',
    '31–35 “I must bend the truth, exaggerate, or outright',
    'lie to be interesting to other people.”',
    '36–45 “Achieving my goal is the only thing of interest',
    'to me, and I’ll ignore everything else to pursue',
    'it.”',
    '46–50 “I find it hard to care about anything that goes',
    'on around me.”',
    '51–55 “I don’t like the way people judge me all the',
    'time.”',
    '56–70 “I am the smartest, wisest, strongest, fastest,',
    'and most beautiful person I know.”',
    '71–80 “I am convinced that powerful enemies are',
    'hunting me, and their agents are everywhere I',
    'go. I am sure they’re watching me all the time.”',
    '81–85 “There’s only one person I can trust. And only I',
    'can see this special friend.”',
    '86–95 “I can’t take anything seriously. The more',
    'serious the situation, the funnier I find it.”',
    '96–100 “I’ve discovered that I really like killing people.”',
    'Curing Madness',
    'A calm emotions spell can suppress the effects of madness.',
  ]),
];

const OBJECT_TABLE_PAGE = page(203, [
  'Object Armor Class',
  'Substance AC',
  'Cloth, paper, rope 11',
  'Crystal, glass, ice 13',
  'Wood, bone 15',
  'Stone 17',
  'Iron, steel 19',
  'Mithral 21',
  'Adamantine 23',
  'Hit Points. An object’s hit points measure how much damage it can take.',
  'Object Hit Points',
  'Size',
  'Tiny (bottle, lock)',
  'Small (chest, lute)',
  'Medium (barrel, chandelier)',
  'Large (cart, 10-ft.-by-10-ft. window)',
  'Huge and Gargantuan Objects. Normal weapons are of little use.',
  'Objects and Damage Types. Objects are immune to poison and psychic damage.',
  'Damage Threshold. Big objects such as castle walls have extra resilience.',
  'Fragile Resilient',
  '2 (1d4) 5 (2d4)',
  '3 (1d6) 10 (3d6)',
  '4 (1d8) 18 (4d8)',
  '5 (1d10) 27 (5d10)',
]);

const INLINE_OBJECT_HIT_POINTS_PAGE = page(203, [
  'Object Hit Points',
  'Size Fragile Resilient',
  'Tiny (bottle, lock) 2 (1d4) 5 (2d4)',
  'Small (chest, lute) 3 (1d6) 10 (3d6)',
  'Medium (barrel, chandelier) 4 (1d8) 18 (4d8)',
  'Large (cart, 10-ft.-by-10-ft. window) 5 (1d10) 27 (5d10)',
  'Huge and Gargantuan Objects. Normal weapons are of little use.',
]);

describe('parseTables', () => {
  it('extracts the two-column ability-check DC table', () => {
    const tables = parseTables([DIFFICULTY_CLASSES_PAGE]);
    expect(tables).toEqual([
      {
        name: 'Difficulty Classes',
        columns: ['Task Difficulty', 'DC'],
        rows: [
          ['Very easy', 5],
          ['Easy', 10],
          ['Medium', 15],
          ['Hard', 20],
          ['Very hard', 25],
          ['Nearly impossible', 30],
        ],
        sourcePage: 77,
      },
    ]);
  });

  it('reconstructs the two trap reference tables (loreweaver-hvp)', () => {
    const tables = parseTables([TRAP_TABLES_PAGE]);
    // Sorted by name: Damage Severity by Level, then Trap Save DCs.
    expect(tables).toEqual([
      {
        name: 'Damage Severity by Level',
        columns: ['Character Level', 'Setback', 'Dangerous', 'Deadly'],
        rows: [
          ['1st–4th', '1d10', '2d10', '4d10'],
          ['5th–10th', '2d10', '4d10', '10d10'],
          ['11th–16th', '4d10', '10d10', '18d10'],
          ['17th–20th', '10d10', '18d10', '24d10'],
        ],
        sourcePage: 196,
      },
      {
        name: 'Trap Save DCs and Attack Bonuses',
        columns: ['Trap Danger', 'Save DC', 'Attack Bonus'],
        rows: [
          ['Setback', '10–11', '+3 to +5'],
          ['Dangerous', '12–15', '+6 to +8'],
          ['Deadly', '16–20', '+9 to +12'],
        ],
        sourcePage: 196,
      },
    ]);
  });

  it('stops each trap table at the next heading (no row over-capture)', () => {
    const tables = parseTables([TRAP_TABLES_PAGE]);
    const damage = tables.find((t) => t.name === 'Damage Severity by Level');
    // "Complex Traps" and its prose must not be captured as rows.
    expect(damage?.rows).toHaveLength(4);
  });

  it('extracts the multi-column encounter XP threshold table', () => {
    const tables = parseTables([ENCOUNTER_THRESHOLDS_PAGE]);
    expect(tables).toEqual([
      {
        name: 'XP Thresholds by Character Level',
        columns: ['Character Level', 'Easy', 'Medium', 'Hard', 'Deadly'],
        rows: [
          ['1st', 25, 50, 75, 100],
          ['2nd', 50, 100, 150, 200],
          ['3rd', 75, 150, 225, 400],
          ['4th', 125, 250, 375, 500],
        ],
        sourcePage: 84,
      },
    ]);
  });

  it('reconstructs treasure tables emitted as interleaved column blocks', () => {
    const tables = parseTables([INTERLEAVED_TREASURE_PAGE]);
    expect(tables).toEqual([
      {
        name: 'Individual Treasure: Challenge 0-4',
        columns: ['d100', 'CP', 'SP', 'EP', 'GP', 'PP'],
        rows: [
          ['01-30', '5d6 (17)', null, null, null, null],
          ['31-60', null, '4d6 (14)', null, null, null],
          ['61-70', null, null, '3d6 (10)', null, null],
        ],
        sourcePage: 136,
      },
      {
        name: 'Treasure Hoard: Challenge 0-4',
        columns: [
          'd100',
          'CP',
          'SP',
          'GP',
          'Gems or Art Objects',
          'Magic Items',
        ],
        rows: [
          [
            '01-06',
            '6d6 x 100 (2,100)',
            '3d6 x 100 (1,050)',
            '2d6 x 10 (70)',
            null,
            null,
          ],
          [
            '07-16',
            '6d6 x 100 (2,100)',
            '3d6 x 100 (1,050)',
            '2d6 x 10 (70)',
            '2d6 (7) 10 gp gems',
            null,
          ],
          [
            '17-26',
            '6d6 x 100 (2,100)',
            '3d6 x 100 (1,050)',
            '2d6 x 10 (70)',
            '2d4 (5) 25 gp art objects',
            'Table A',
          ],
        ],
        sourcePage: 136,
      },
    ]);
  });

  it('rejects incomplete treasure column blocks instead of consuming later headings as cells', () => {
    expect(parseTables([INCOMPLETE_TREASURE_PAGE])).toEqual([]);
  });

  it('reconstructs the Madness effect tables and Objects statistics tables', () => {
    expect(parseTables([...MADNESS_TABLE_PAGES, OBJECT_TABLE_PAGE])).toEqual([
      {
        name: 'Indefinite Madness',
        columns: ['d100', 'Flaw'],
        rows: [
          ['01–15', '“Being drunk keeps me sane.”'],
          ['16–25', '“I keep whatever I find.”'],
          [
            '26–30',
            '“I try to become more like someone else I know—adopting his or her style of dress, mannerisms, and name.”',
          ],
          [
            '31–35',
            '“I must bend the truth, exaggerate, or outright lie to be interesting to other people.”',
          ],
          [
            '36–45',
            '“Achieving my goal is the only thing of interest to me, and I’ll ignore everything else to pursue it.”',
          ],
          [
            '46–50',
            '“I find it hard to care about anything that goes on around me.”',
          ],
          ['51–55', '“I don’t like the way people judge me all the time.”'],
          [
            '56–70',
            '“I am the smartest, wisest, strongest, fastest, and most beautiful person I know.”',
          ],
          [
            '71–80',
            '“I am convinced that powerful enemies are hunting me, and their agents are everywhere I go. I am sure they’re watching me all the time.”',
          ],
          [
            '81–85',
            '“There’s only one person I can trust. And only I can see this special friend.”',
          ],
          [
            '86–95',
            '“I can’t take anything seriously. The more serious the situation, the funnier I find it.”',
          ],
          ['96–100', '“I’ve discovered that I really like killing people.”'],
        ],
        sourcePage: 202,
      },
      {
        name: 'Long-Term Madness',
        columns: ['d100', 'Effect'],
        rows: [
          [
            '01–10',
            'The character feels compelled to repeat a specific activity over and over, such as washing hands, touching things, praying, or counting coins.',
          ],
          [
            '11–20',
            'The character experiences vivid hallucinations and has disadvantage on ability checks.',
          ],
          [
            '21–30',
            'The character suffers extreme paranoia. The character has disadvantage on Wisdom and Charisma checks.',
          ],
          [
            '31–40',
            'The character regards something (usually the source of madness) with intense revulsion, as if affected by the antipathy effect of the antipathy/sympathy spell.',
          ],
          [
            '41–45',
            'The character experiences a powerful delusion. Choose a potion. The character imagines that he or she is under its effects.',
          ],
          [
            '46–55',
            'The character becomes attached to a “lucky charm,” such as a person or an object, and has disadvantage on attack rolls, ability checks, and saving throws while more than 30 feet from it.',
          ],
          ['56–65', 'The character is blinded (25%) or deafened (75%).'],
          [
            '66–75',
            'The character experiences uncontrollable tremors or tics, which impose disadvantage on attack rolls, ability checks, and saving throws that involve Strength or Dexterity.',
          ],
          [
            '76–85',
            'The character suffers from partial amnesia. The character knows who he or she is and retains racial traits and class features, but doesn’t recognize other people or remember anything that happened before the madness took effect.',
          ],
          [
            '86–90',
            'Whenever the character takes damage, he or she must succeed on a DC 15 Wisdom saving throw or be affected as though he or she failed a saving throw against the confusion spell. The confusion effect lasts for 1 minute.',
          ],
          ['91–95', 'The character loses the ability to speak.'],
          [
            '96–100',
            'The character falls unconscious. No amount of jostling or damage can wake the character.',
          ],
        ],
        sourcePage: 201,
      },
      {
        name: 'Object Armor Class',
        columns: ['Substance', 'AC'],
        rows: [
          ['Cloth, paper, rope', 11],
          ['Crystal, glass, ice', 13],
          ['Wood, bone', 15],
          ['Stone', 17],
          ['Iron, steel', 19],
          ['Mithral', 21],
          ['Adamantine', 23],
        ],
        sourcePage: 203,
      },
      {
        name: 'Object Hit Points',
        columns: ['Size', 'Fragile', 'Resilient'],
        rows: [
          ['Tiny (bottle, lock)', '2 (1d4)', '5 (2d4)'],
          ['Small (chest, lute)', '3 (1d6)', '10 (3d6)'],
          ['Medium (barrel, chandelier)', '4 (1d8)', '18 (4d8)'],
          ['Large (cart, 10-ft.-by-10-ft. window)', '5 (1d10)', '27 (5d10)'],
        ],
        sourcePage: 203,
      },
      {
        name: 'Short-Term Madness',
        columns: ['d100', 'Effect'],
        rows: [
          [
            '01–20',
            'The character retreats into his or her mind and becomes paralyzed. The effect ends if the character takes any damage.',
          ],
          [
            '21–30',
            'The character becomes incapacitated and spends the duration screaming, laughing, or weeping.',
          ],
          [
            '31–40',
            'The character becomes frightened and must use his or her action and movement each round to flee from the source of the fear.',
          ],
          [
            '41–50',
            'The character begins babbling and is incapable of normal speech or spellcasting.',
          ],
          [
            '51–60',
            'The character must use his or her action each round to attack the nearest creature.',
          ],
          [
            '61–70',
            'The character experiences vivid hallucinations and has disadvantage on ability checks.',
          ],
          [
            '71–75',
            'The character does whatever anyone tells him or her to do that isn’t obviously self-destructive.',
          ],
          [
            '76–80',
            'The character experiences an overpowering urge to eat something strange such as dirt, slime, or offal.',
          ],
          ['81–90', 'The character is stunned.'],
          ['91–100', 'The character falls unconscious.'],
        ],
        sourcePage: 201,
      },
    ]);
  });

  it('omits an incomplete Object Hit Points column block', () => {
    const incomplete = page(203, [
      'Object Hit Points',
      'Size',
      'Tiny (bottle, lock)',
      'Small (chest, lute)',
      'Medium (barrel, chandelier)',
      'Large (cart, 10-ft.-by-10-ft. window)',
      'Fragile Resilient',
      '2 (1d4) 5 (2d4)',
      '3 (1d6) 10 (3d6)',
      '4 (1d8) 18 (4d8)',
    ]);
    expect(parseTables([incomplete])).toEqual([]);
  });

  it('reconstructs Object Hit Points from inline extracted rows', () => {
    expect(parseTables([INLINE_OBJECT_HIT_POINTS_PAGE])).toEqual([
      {
        name: 'Object Hit Points',
        columns: ['Size', 'Fragile', 'Resilient'],
        rows: [
          ['Tiny (bottle, lock)', '2 (1d4)', '5 (2d4)'],
          ['Small (chest, lute)', '3 (1d6)', '10 (3d6)'],
          ['Medium (barrel, chandelier)', '4 (1d8)', '18 (4d8)'],
          ['Large (cart, 10-ft.-by-10-ft. window)', '5 (1d10)', '27 (5d10)'],
        ],
        sourcePage: 203,
      },
    ]);
  });

  it('sorts tables by name for stable downstream emission', () => {
    const tables = parseTables([
      ENCOUNTER_THRESHOLDS_PAGE,
      DIFFICULTY_CLASSES_PAGE,
    ]);
    expect(tables.map((t) => t.name)).toEqual([
      'Difficulty Classes',
      'XP Thresholds by Character Level',
    ]);
  });

  it('returns an empty array when no supported table anchors are present', () => {
    expect(
      parseTables([page(1, ['Cover', 'Walls can provide cover.'])]),
    ).toEqual([]);
  });
});
