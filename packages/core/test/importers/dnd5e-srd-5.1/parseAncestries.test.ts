/**
 * Race / ancestry-parser unit tests for the D&D 5e SRD 5.1 importer.
 *
 * Race text excerpts in this file are reproduced from the System Reference
 * Document 5.1 by Wizards of the Coast LLC, available under the Creative
 * Commons Attribution 4.0 International License (CC-BY-4.0). Excerpts are used
 * as parser test input; no modification has been made beyond reformatting to
 * match the importer's extracted-line input shape.
 *
 * Subrace decision under test (loreweaver-0m9.5.6): parents and subraces are
 * separate records, and each subrace record is flattened/self-contained.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractPdfText } from '../../../scripts/importers/dnd5e-srd-5.1/extract.js';
import { EXPECTED_SRD_5_1_ANCESTRY_NAMES } from '../../../scripts/importers/dnd5e-srd-5.1/index.js';
import { parseAncestries } from '../../../scripts/importers/dnd5e-srd-5.1/parseAncestries.js';
import {
  SRD_5_1_DEFAULT_SECTION_ANCHORS,
  sliceSection,
} from '../../../scripts/importers/dnd5e-srd-5.1/sections.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

// ---------------------------------------------------------------------------
// Dwarf (a race WITH subraces) + Hill Dwarf / Mountain Dwarf (subraces).
// ---------------------------------------------------------------------------

const DWARF_PAGE = page(18, [
  'Dwarf',
  'Bold and hardy, dwarves are known as skilled warriors, miners, and workers of stone and metal.',
  'Dwarf Traits',
  'Your dwarf character has an assortment of inborn abilities, part and parcel of dwarven nature.',
  'Ability Score Increase. Your Constitution score increases by 2.',
  "Age. Dwarves mature at the same rate as humans, but they're considered young until they reach the age of 50. On average, they live about 350 years.",
  'Alignment. Most dwarves are lawful, believing firmly in the benefits of a well-ordered society.',
  'Size. Dwarves stand between 4 and 5 feet tall and average about 150 pounds. Your size is Medium.',
  'Speed. Your base walking speed is 25 feet. Your speed is not reduced by wearing heavy armor.',
  'Darkvision. Accustomed to life underground, you have superior vision in dark and dim conditions.',
  'Dwarven Resilience. You have advantage on saving throws against poison, and you have resistance against poison damage.',
  'Dwarven Combat Training. You have proficiency with the battleaxe, handaxe, light hammer, and warhammer.',
  'Languages. You can speak, read, and write Common and Dwarvish.',
  'Subrace. Two main subraces of dwarves populate the worlds of D&D: hill dwarves and mountain dwarves. Choose one of these subraces.',
  'Hill Dwarf',
  'As a hill dwarf, you have keen senses, deep intuition, and remarkable resilience.',
  'Ability Score Increase. Your Wisdom score increases by 1.',
  'Dwarven Toughness. Your hit point maximum increases by 1, and it increases by 1 every time you gain a level.',
  'Mountain Dwarf',
  "As a mountain dwarf, you're strong and hardy, accustomed to a difficult life in rugged terrain.",
  'Ability Score Increase. Your Strength score increases by 2.',
  'Dwarven Armor Training. You have proficiency with light and medium armor.',
]);

// ---------------------------------------------------------------------------
// Human (a race with NO subraces).
// ---------------------------------------------------------------------------

const HUMAN_PAGE = page(31, [
  'Human',
  'In the reckonings of most worlds, humans are the youngest of the common races.',
  'Human Traits',
  "It's hard to make generalizations about humans, but your human character has these traits.",
  'Ability Score Increase. Your ability scores each increase by 1.',
  'Age. Humans reach adulthood in their late teens and live less than a century.',
  'Alignment. Humans tend toward no particular alignment. The best and the worst are found among them.',
  'Size. Humans vary widely in height and build, from barely 5 feet to well over 6 feet tall. Your size is Medium.',
  'Speed. Your base walking speed is 30 feet.',
  'Languages. You can speak, read, and write Common and one extra language of your choice.',
]);

describe('parseAncestries — Dwarf with subraces + Human without', () => {
  const results = parseAncestries([DWARF_PAGE, HUMAN_PAGE]);

  it('emits one record per race AND per subrace', () => {
    const names = results.map((r) => r.name);
    expect(names).toEqual(['Dwarf', 'Hill Dwarf', 'Human', 'Mountain Dwarf']);
  });

  it('returns output sorted by name', () => {
    const names = results.map((r) => r.name);
    expect(names).toEqual([...names].sort());
  });

  // --- race with subraces ---
  describe('Dwarf (race with subraces)', () => {
    const dwarf = results.find((r) => r.name === 'Dwarf');

    it('lists its subraces in document order', () => {
      expect(dwarf?.subraces).toEqual(['Hill Dwarf', 'Mountain Dwarf']);
    });

    it('is not itself a subrace', () => {
      expect(dwarf?.subraceOf).toBeUndefined();
    });

    it('captures ability score increase, age, alignment, size, speed, languages, and racial traits', () => {
      const labels = dwarf?.traits.map((t) => t.name) ?? [];
      expect(labels).toEqual(
        expect.arrayContaining([
          'Ability Score Increase',
          'Age',
          'Alignment',
          'Size',
          'Speed',
          'Languages',
          'Darkvision',
          'Dwarven Resilience',
          'Dwarven Combat Training',
          'Subrace',
        ]),
      );
    });

    it('normalizes size and speed convenience fields', () => {
      expect(dwarf?.size).toBe('Medium');
      expect(dwarf?.speed).toBe(25);
    });

    it('puts flavor text in description, not the "Dwarf Traits" header or trait lines', () => {
      expect(dwarf?.description).toMatch(/Bold and hardy/);
      expect(dwarf?.description).not.toMatch(/Dwarf Traits/);
      expect(dwarf?.description).not.toMatch(/Ability Score Increase/);
    });

    it('records the source page', () => {
      expect(dwarf?.sourcePage).toBe(18);
    });
  });

  // --- subrace record ---
  describe('Hill Dwarf (subrace, flattened)', () => {
    const hill = results.find((r) => r.name === 'Hill Dwarf');

    it('points back to its parent race', () => {
      expect(hill?.subraceOf).toBe('Dwarf');
    });

    it('does not declare its own subraces', () => {
      expect(hill?.subraces).toBeUndefined();
    });

    it('is self-contained: inherits the parent racial traits', () => {
      const labels = hill?.traits.map((t) => t.name) ?? [];
      expect(labels).toEqual(
        expect.arrayContaining([
          'Darkvision',
          'Dwarven Resilience',
          'Dwarven Combat Training',
          'Languages',
        ]),
      );
    });

    it('includes its own subrace traits', () => {
      const toughness = hill?.traits.find(
        (t) => t.name === 'Dwarven Toughness',
      );
      expect(toughness?.text).toMatch(/hit point maximum increases by 1/);
    });

    it('merges the additive ability score increase into one trait', () => {
      const asi = hill?.traits.filter(
        (t) => t.name === 'Ability Score Increase',
      );
      expect(asi).toHaveLength(1);
      expect(asi?.[0].text).toMatch(/Constitution score increases by 2/);
      expect(asi?.[0].text).toMatch(/Wisdom score increases by 1/);
    });

    it('drops the parent-only "Subrace" pointer trait from the flattened set', () => {
      const labels = hill?.traits.map((t) => t.name) ?? [];
      expect(labels).not.toContain('Subrace');
    });

    it('inherits size and speed from the parent', () => {
      expect(hill?.size).toBe('Medium');
      expect(hill?.speed).toBe(25);
    });

    it('uses its own flavor text for the description', () => {
      expect(hill?.description).toMatch(/As a hill dwarf/);
    });
  });

  describe('Mountain Dwarf (subrace, flattened)', () => {
    const mountain = results.find((r) => r.name === 'Mountain Dwarf');

    it('merges its +2 Strength into the inherited +2 Constitution', () => {
      const asi = mountain?.traits.find(
        (t) => t.name === 'Ability Score Increase',
      );
      expect(asi?.text).toMatch(/Constitution score increases by 2/);
      expect(asi?.text).toMatch(/Strength score increases by 2/);
    });

    it('includes its own Dwarven Armor Training trait', () => {
      const labels = mountain?.traits.map((t) => t.name) ?? [];
      expect(labels).toContain('Dwarven Armor Training');
    });
  });

  // --- race without subraces ---
  describe('Human (race without subraces)', () => {
    const human = results.find((r) => r.name === 'Human');

    it('leaves subraces undefined', () => {
      expect(human?.subraces).toBeUndefined();
    });

    it('is not a subrace', () => {
      expect(human?.subraceOf).toBeUndefined();
    });

    it('captures the core trait labels', () => {
      const labels = human?.traits.map((t) => t.name) ?? [];
      expect(labels).toEqual(
        expect.arrayContaining([
          'Ability Score Increase',
          'Age',
          'Alignment',
          'Size',
          'Speed',
          'Languages',
        ]),
      );
    });

    it('does not bleed Dwarf traits into Human', () => {
      const labels = human?.traits.map((t) => t.name) ?? [];
      expect(labels).not.toContain('Darkvision');
      expect(labels).not.toContain('Dwarven Resilience');
    });

    it('normalizes size and speed', () => {
      expect(human?.size).toBe('Medium');
      expect(human?.speed).toBe(30);
    });

    it('records its own source page', () => {
      expect(human?.sourcePage).toBe(31);
    });
  });
});

// ---------------------------------------------------------------------------
// Empty / no-match input.
// ---------------------------------------------------------------------------

describe('parseAncestries — empty and no-match input', () => {
  it('returns an empty array for an empty page list', () => {
    expect(parseAncestries([])).toEqual([]);
  });

  it('returns an empty array when no known race heading appears', () => {
    const p = page(1, ['This is not a race.', 'Some other text here.']);
    expect(parseAncestries([p])).toEqual([]);
  });
});

describe('parseAncestries — halfling subrace canonical names', () => {
  const results = parseAncestries([
    page(26, [
      'Halfling',
      'The comforts of home are the goals of most halflings.',
      'Halfling Traits',
      'Your halfling character has a number of traits in common with all other halflings.',
      'Ability Score Increase. Your Dexterity score increases by 2.',
      'Size. Halflings average about 3 feet tall and weigh about 40 pounds. Your size is Small.',
      'Speed. Your base walking speed is 25 feet.',
      'Lucky. When you roll a 1 on an attack roll, ability check, or saving throw, you can reroll the die.',
      'Subrace. The two main kinds of halfling are lightfoot and stout.',
      'Lightfoot',
      'As a lightfoot halfling, you can easily hide from notice.',
      'Ability Score Increase. Your Charisma score increases by 1.',
      'Naturally Stealthy. You can attempt to hide even when you are obscured only by a creature.',
      'Stout',
      "As a stout halfling, you're hardier than average.",
      'Ability Score Increase. Your Constitution score increases by 1.',
      'Stout Resilience. You have advantage on saving throws against poison.',
    ]),
  ]);

  it('parent-qualifies bare SRD halfling subrace headings for records and lookup', () => {
    expect(results.map((r) => r.name)).toEqual([
      'Halfling',
      'Lightfoot Halfling',
      'Stout Halfling',
    ]);

    const halfling = results.find((r) => r.name === 'Halfling');
    expect(halfling?.subraces).toEqual([
      'Lightfoot Halfling',
      'Stout Halfling',
    ]);

    const lightfoot = results.find((r) => r.name === 'Lightfoot Halfling');
    expect(lightfoot?.subraceOf).toBe('Halfling');
    expect(lightfoot?.size).toBe('Small');
    expect(lightfoot?.speed).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// Real-PDF coverage (loreweaver-3m1)
// ---------------------------------------------------------------------------
//
// The SRD 5.1 PDF publishes 9 base races and exactly 4 subraces — Hill Dwarf,
// High Elf, Lightfoot Halfling, Rock Gnome. The other PHB subraces (Mountain
// Dwarf, Wood Elf, Dark Elf/Drow, Stout Halfling, Forest Gnome) are not part
// of the CC-BY-4.0 SRD 5.1 at all. The orchestrator's
// `EXPECTED_SRD_5_1_ANCESTRY_NAMES` constant originally claimed all 18, which
// caused `verify:dnd5e-srd-pack` to fail closed against a perfectly correct
// 13-record parse. These tests pin the 13-record reality so the constant
// can't silently drift back to the PHB set, and prove the parser produces
// exactly that set when run against the vendored PDF.

describe('parseAncestries — real SRD 5.1 PDF coverage (loreweaver-3m1)', () => {
  const SRD_PDF_PATH = join(
    process.cwd(),
    'packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf',
  );

  it('EXPECTED_SRD_5_1_ANCESTRY_NAMES carries the 13 actual SRD 5.1 names', () => {
    // The SRD 5.1 has 9 base races plus 4 subraces (one per race-with-subraces).
    // A regression that re-adds Mountain Dwarf etc. to this list would make the
    // ancestry coverage check fail against the real PDF.
    expect([...EXPECTED_SRD_5_1_ANCESTRY_NAMES].sort()).toEqual(
      [
        'Dragonborn',
        'Dwarf',
        'Elf',
        'Gnome',
        'Half-Elf',
        'Half-Orc',
        'Halfling',
        'Human',
        'Tiefling',
        'Hill Dwarf',
        'High Elf',
        'Lightfoot Halfling',
        'Rock Gnome',
      ].sort(),
    );
    expect(EXPECTED_SRD_5_1_ANCESTRY_NAMES).toHaveLength(13);
    // Sanity guard: PHB-only subraces must NOT appear here. Adding them is
    // exactly the bug loreweaver-3m1 fixed.
    for (const phbOnly of [
      'Mountain Dwarf',
      'Wood Elf',
      'Dark Elf (Drow)',
      'Stout Halfling',
      'Forest Gnome',
    ]) {
      expect(EXPECTED_SRD_5_1_ANCESTRY_NAMES).not.toContain(phbOnly);
    }
  });

  it('parses exactly the EXPECTED set from the vendored SRD 5.1 PDF', async () => {
    // Narrow extraction to the races chapter (PDF pages 3-7) plus page 8
    // where "Barbarian" first appears — the races endHeading anchor — so
    // sliceSection's requireEndHeading guard is satisfied without paying for
    // a 403-page extract. Keeps the test well under the suite's default
    // timeout while still exercising real PDF text and column-aware layout.
    const pdfBytes = readFileSync(SRD_PDF_PATH);
    const pages = await extractPdfText(new Uint8Array(pdfBytes), {
      pageRange: { start: 3, end: 8 },
    });
    const racePages = sliceSection(
      pages,
      SRD_5_1_DEFAULT_SECTION_ANCHORS.races,
    );
    const ancestries = parseAncestries(racePages);
    const parsedNames = ancestries.map((a) => a.name).sort();
    expect(parsedNames).toEqual([...EXPECTED_SRD_5_1_ANCESTRY_NAMES].sort());
  }, 20000);
});
