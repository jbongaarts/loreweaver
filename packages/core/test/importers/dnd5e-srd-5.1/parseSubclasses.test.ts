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

// ---------------------------------------------------------------------------
// Fighter → Champion: a martial subclass. The slice mirrors the SRD shape: the
// base-class name and its Class Features precede the "Martial Archetypes" intro
// and the "Champion" subclass heading.
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

  it('captures the subclass body prose (including its granted-feature text)', () => {
    expect(champion.description).toMatch(/archetypal Champion focuses/);
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
