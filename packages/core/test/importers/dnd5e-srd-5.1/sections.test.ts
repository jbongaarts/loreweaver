/**
 * Tests for the deterministic section slicer.
 *
 * The slicer is the importer's safety boundary: parsers are only correct on
 * narrowed input, and the slicer is what does the narrowing. These tests
 * cover both the success paths and — critically — the fail-closed behavior
 * when an anchor doesn't match.
 */

import { describe, expect, it } from 'vitest';
import {
  SRD_5_1_DEFAULT_SECTION_ANCHORS,
  SectionNotFoundError,
  sliceSection,
} from '../../../scripts/importers/dnd5e-srd-5.1/sections.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

describe('sliceSection — happy path', () => {
  const pages: PageText[] = [
    page(1, ['Intro', 'Some intro text.']),
    page(2, ['Spells', 'Acid Splash', 'Conjuration cantrip']),
    page(3, ['Burning Hands', '1st-level evocation']),
    page(4, ['Monsters', 'Goblin', 'Small humanoid']),
  ];

  it('starts after the heading line and excludes it from the slice', () => {
    const sliced = sliceSection(pages, {
      startHeading: /^Spells$/,
      endHeading: /^Monsters$/,
    });
    // Page 2 in the slice should NOT include the "Spells" heading line.
    expect(sliced[0].lines[0]).toBe('Acid Splash');
  });

  it('stops just before the end heading and excludes it from the slice', () => {
    const sliced = sliceSection(pages, {
      startHeading: /^Spells$/,
      endHeading: /^Monsters$/,
    });
    // The slice should not include the "Monsters" page's content.
    const allLines = sliced.flatMap((p) => p.lines);
    expect(allLines).not.toContain('Monsters');
    expect(allLines).not.toContain('Goblin');
    expect(allLines).not.toContain('Small humanoid');
  });

  it('preserves pageNumber for traceability', () => {
    const sliced = sliceSection(pages, {
      startHeading: /^Spells$/,
      endHeading: /^Monsters$/,
    });
    // Slice spans page 2 (after the heading) and page 3 (whole page).
    expect(sliced.map((p) => p.pageNumber)).toEqual([2, 3]);
  });

  it('slices to end of document when endHeading is undefined', () => {
    const sliced = sliceSection(pages, {
      startHeading: /^Monsters$/,
    });
    const allLines = sliced.flatMap((p) => p.lines);
    expect(allLines).toContain('Goblin');
    expect(allLines).toContain('Small humanoid');
  });

  it('slices to end of document when endHeading is set but never matches', () => {
    const sliced = sliceSection(pages, {
      startHeading: /^Monsters$/,
      endHeading: /^NoSuchHeading$/,
    });
    const allLines = sliced.flatMap((p) => p.lines);
    expect(allLines).toContain('Goblin');
  });

  it('omits empty pages from the result', () => {
    const padded: PageText[] = [
      page(1, ['Spells']), // heading only — leaves nothing after stripping
      page(2, ['Acid Splash']),
      page(3, ['Monsters', 'Goblin']),
    ];
    const sliced = sliceSection(padded, {
      startHeading: /^Spells$/,
      endHeading: /^Monsters$/,
    });
    // Page 1's only line is the heading; that page should not appear empty
    // in the slice.
    expect(sliced.every((p) => p.lines.length > 0)).toBe(true);
    expect(sliced.map((p) => p.pageNumber)).toEqual([2]);
  });
});

describe('sliceSection — fail-closed behavior', () => {
  it('throws SectionNotFoundError when startHeading does not match', () => {
    const pages: PageText[] = [page(1, ['Hello world'])];
    expect(() =>
      sliceSection(pages, {
        startHeading: /^Spells$/,
        endHeading: /^Monsters$/,
      }),
    ).toThrow(SectionNotFoundError);
  });

  it('error names the unmatched pattern so the caller can fix it', () => {
    const pages: PageText[] = [page(1, ['Hello world'])];
    expect(() =>
      sliceSection(pages, {
        startHeading: /^Spells$/,
      }),
    ).toThrow(/start heading not found.*\/\^Spells\$\//);
  });

  it('matches against trimmed lines, not raw lines', () => {
    const pages: PageText[] = [
      page(1, ['   Spells   ', 'Acid Splash']),
      page(2, ['Monsters', 'Goblin']),
    ];
    const sliced = sliceSection(pages, {
      startHeading: /^Spells$/,
      endHeading: /^Monsters$/,
    });
    expect(sliced[0].lines).toEqual(['Acid Splash']);
  });

  it('throws SectionNotFoundError when requireEndHeading is true and endHeading does not match', () => {
    const pages: PageText[] = [
      page(1, ['Spells', 'Acid Splash', 'Conjuration cantrip']),
    ];
    expect(() =>
      sliceSection(pages, {
        startHeading: /^Spells$/,
        endHeading: /^Monsters$/,
        requireEndHeading: true,
      }),
    ).toThrow(SectionNotFoundError);
  });

  it('end-required error names the unmatched end pattern', () => {
    const pages: PageText[] = [page(1, ['Spells', 'Acid Splash'])];
    expect(() =>
      sliceSection(pages, {
        startHeading: /^Spells$/,
        endHeading: /^Monsters$/,
        requireEndHeading: true,
      }),
    ).toThrow(/end heading not found.*\/\^Monsters\$\//);
  });

  it('preserves slice-to-EOF fallback when requireEndHeading is false and endHeading is unmatched', () => {
    const pages: PageText[] = [
      page(1, ['Spells', 'Acid Splash']),
      page(2, ['Magic Missile']),
    ];
    const sliced = sliceSection(pages, {
      startHeading: /^Spells$/,
      endHeading: /^Monsters$/,
      requireEndHeading: false,
    });
    const allLines = sliced.flatMap((p) => p.lines);
    expect(allLines).toEqual(['Acid Splash', 'Magic Missile']);
  });

  it('preserves slice-to-EOF fallback when requireEndHeading is omitted', () => {
    const pages: PageText[] = [
      page(1, ['Spells', 'Acid Splash']),
      page(2, ['Magic Missile']),
    ];
    const sliced = sliceSection(pages, {
      startHeading: /^Spells$/,
      endHeading: /^Monsters$/,
    });
    const allLines = sliced.flatMap((p) => p.lines);
    expect(allLines).toEqual(['Acid Splash', 'Magic Missile']);
  });
});

describe('SRD_5_1_DEFAULT_SECTION_ANCHORS — sanity', () => {
  it('spell-lists anchor matches "Spell Lists" exactly', () => {
    const anchor = SRD_5_1_DEFAULT_SECTION_ANCHORS.spellLists;
    expect(anchor.startHeading.test('Spell Lists')).toBe(true);
    // Should not false-positive on body prose mentions:
    expect(anchor.startHeading.test('See the Spell Lists chapter')).toBe(false);
  });

  it('spell-descriptions anchor matches either "Spells" or "Spell Descriptions"', () => {
    const anchor = SRD_5_1_DEFAULT_SECTION_ANCHORS.spellDescriptions;
    expect(anchor.startHeading.test('Spells')).toBe(true);
    expect(anchor.startHeading.test('Spell Descriptions')).toBe(true);
  });

  it('spell-lists anchor end-heading matches the spell-descriptions chapter heading', () => {
    const anchor = SRD_5_1_DEFAULT_SECTION_ANCHORS.spellLists;
    expect(anchor.endHeading).toBeDefined();
    if (anchor.endHeading !== undefined) {
      expect(anchor.endHeading.test('Spells')).toBe(true);
      expect(anchor.endHeading.test('Spell Descriptions')).toBe(true);
    }
  });

  it('both default anchors require an end heading (fail-closed on missing chapter boundary)', () => {
    expect(SRD_5_1_DEFAULT_SECTION_ANCHORS.spellLists.requireEndHeading).toBe(
      true,
    );
    expect(
      SRD_5_1_DEFAULT_SECTION_ANCHORS.spellDescriptions.requireEndHeading,
    ).toBe(true);
  });

  it('the hazards anchor also requires an end heading (fail-closed on missing dungeon-hazards boundary)', () => {
    expect(SRD_5_1_DEFAULT_SECTION_ANCHORS.hazards.requireEndHeading).toBe(
      true,
    );
  });

  it('core-rules anchor starts at "Using Ability Scores" and requires an end heading', () => {
    const anchor = SRD_5_1_DEFAULT_SECTION_ANCHORS.coreRules;
    expect(anchor.startHeading.test('Using Ability Scores')).toBe(true);
    expect(anchor.requireEndHeading).toBe(true);
  });
});
