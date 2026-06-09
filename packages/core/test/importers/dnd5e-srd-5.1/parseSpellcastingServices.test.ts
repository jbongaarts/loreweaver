/**
 * Unit tests for the Spellcasting Services rule parser (eshyra-0m9.19).
 *
 * The excerpt is reproduced from the System Reference Document 5.1 by Wizards
 * of the Coast LLC, available under the Creative Commons Attribution 4.0
 * International License (CC-BY-4.0), reformatted to the importer's extracted-line
 * input shape (the soft-wrapped lines the PDF text layer produces).
 */

import { describe, expect, it } from 'vitest';
import { parseSpellcastingServices } from '../../../scripts/importers/dnd5e-srd-5.1/parseSpellcastingServices.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

const EXPENSES_SLICE = [
  page(74, [
    'Spellcasting Services',
    'People who are able to cast spells don’t fall into the',
    'category of ordinary hirelings. It might be possible',
    'to find someone willing to cast a spell in exchange',
    'for coin or favors, but it is rarely easy and no',
    'established pay rates exist.',
    'Hiring someone to cast a relatively common spell',
    'of 1st or 2nd level, such as cure wounds or identify, is',
    'easy enough in a city or town, and might cost 10 to',
    '50 gold pieces (plus the cost of any expensive',
    'material components).',
  ]),
  page(75, ['Feats', 'A feat represents a talent or an area of expertise.']),
];

describe('parseSpellcastingServices', () => {
  it('emits a single rule record bounded by the Feats heading', () => {
    const rule = parseSpellcastingServices(EXPENSES_SLICE);
    expect(rule).toBeDefined();
    expect(rule?.name).toBe('Spellcasting Services');
    expect(rule?.keySlug).toBe('spellcasting-services');
    expect(rule?.sourcePage).toBe(74);
    // Soft-wrapped lines reflow into one block; the Feats chapter is excluded.
    expect(rule?.text).toContain('rarely easy and no established pay rates');
    expect(rule?.text).toContain('might cost 10 to 50 gold pieces');
    expect(rule?.text).not.toContain('Feats');
    expect(rule?.text).not.toContain('feat represents');
  });

  it('returns undefined when the heading is absent (reduced fixture)', () => {
    const noHeading = [page(74, ['Services', 'Service Pay', 'Messenger 2 cp'])];
    expect(parseSpellcastingServices(noHeading)).toBeUndefined();
  });
});
