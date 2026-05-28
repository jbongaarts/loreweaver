/**
 * Reference-table parser unit tests for the D&D 5e SRD 5.1 importer.
 *
 * Table text excerpts in this file are reproduced from the System Reference
 * Document 5.1 by Wizards of the Coast LLC, available under the Creative
 * Commons Attribution 4.0 International License (CC-BY-4.0). Excerpts are
 * used as parser test input; no modification has been made beyond
 * reformatting to match the importer's extracted-line input shape.
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
