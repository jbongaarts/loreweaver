/**
 * Rule-parser unit tests for the D&D 5e SRD 5.1 importer.
 *
 * Rule text excerpts in this file are reproduced from the System Reference
 * Document 5.1 by Wizards of the Coast LLC, available under the Creative
 * Commons Attribution 4.0 International License (CC-BY-4.0). Excerpts are
 * used as parser test input; no modification has been made beyond reformatting
 * to match the importer's extracted-line input shape.
 */

import { describe, expect, it } from 'vitest';
import { parseRules } from '../../../scripts/importers/dnd5e-srd-5.1/parseRules.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

const COVER_AND_RESTING = page(77, [
  'Cover',
  'Walls, trees, creatures, and other obstacles can provide cover during combat,',
  'making a target more difficult to harm.',
  '',
  'A target with half cover has a +2 bonus to AC and Dexterity saving throws.',
  '',
  'Resting',
  'Adventurers can take short rests and long rests to recover from wounds,',
  'regain class resources, and prepare for the next challenge.',
  '',
  'A short rest is at least 1 hour long, and a long rest is at least 8 hours.',
]);

const ADVANTAGE_AND_UNDERWATER = page(78, [
  'Advantage and Disadvantage',
  'Sometimes a special ability or spell tells you that you have advantage or',
  'disadvantage on an ability check, a saving throw, or an attack roll.',
  '',
  'When that happens, you roll a second d20 when you make the roll.',
  '',
  'Underwater Combat',
  'When making a melee weapon attack, a creature that does not have a swimming',
  'speed has disadvantage on the attack roll unless the weapon is a dagger,',
  'javelin, shortsword, spear, or trident.',
]);

describe('parseRules', () => {
  it('extracts labeled rules and sorts by name', () => {
    const rules = parseRules([COVER_AND_RESTING, ADVANTAGE_AND_UNDERWATER]);
    expect(rules).toHaveLength(4);
    expect(rules.map((r) => r.name)).toEqual([
      'Advantage and Disadvantage',
      'Cover',
      'Resting',
      'Underwater Combat',
    ]);
  });

  it('captures full body text in data-text source field shape', () => {
    const [cover] = parseRules([COVER_AND_RESTING]).filter(
      (r) => r.name === 'Cover',
    );
    expect(cover.text).toMatch(/provide cover during combat/);
    expect(cover.text).toMatch(/\+2 bonus to AC/);
    expect(cover.text.length).toBeGreaterThan(0);
  });

  it('does not bleed one rule body into the next heading', () => {
    const [cover] = parseRules([COVER_AND_RESTING]).filter(
      (r) => r.name === 'Cover',
    );
    const [resting] = parseRules([COVER_AND_RESTING]).filter(
      (r) => r.name === 'Resting',
    );
    expect(cover.text).not.toMatch(/Resting/);
    expect(resting.text).not.toMatch(/^Cover$/m);
  });

  it('preserves sourcePage where each heading appears', () => {
    const rules = parseRules([COVER_AND_RESTING, ADVANTAGE_AND_UNDERWATER]);
    const cover = rules.find((r) => r.name === 'Cover');
    const underwater = rules.find((r) => r.name === 'Underwater Combat');
    expect(cover?.sourcePage).toBe(77);
    expect(underwater?.sourcePage).toBe(78);
  });

  it('returns an empty array for empty input', () => {
    expect(parseRules([])).toEqual([]);
  });
});
