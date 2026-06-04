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
