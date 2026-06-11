/**
 * Tests for the SRD source-structure inventory builder (eshyra-4a7.1.1).
 *
 * The inventory is the SOURCE side of the source-coverage gate: a pure,
 * deterministic scan of extracted `PageText[]` that identifies every source
 * structure requiring accounting (headings at all tiers, table captions,
 * stat blocks, caption-less table runs). The classification is driven by the
 * per-line font heights that `extract.ts` already exposes via
 * `PageText.lineHeights`; the tier bands were measured empirically against
 * the real SRD 5.1 PDF (see sourceInventory.ts header for the tier map).
 */

import { describe, expect, it } from 'vitest';
import {
  buildSourceInventory,
  type SourceInventoryItem,
} from '../../../scripts/importers/dnd5e-srd-5.1/sourceInventory.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

/** Build a PageText fixture from [text, height] pairs. */
function page(
  pageNumber: number,
  entries: ReadonlyArray<readonly [string, number]>,
): PageText {
  return {
    pageNumber,
    lines: entries.map((e) => e[0]),
    lineHeights: entries.map((e) => e[1]),
  };
}

function texts(items: readonly SourceInventoryItem[]): string[] {
  return items.map((i) => i.text);
}

describe('buildSourceInventory — tier classification', () => {
  it('classifies the five measured heading tiers and excludes body/legal text', () => {
    const items = buildSourceInventory([
      page(1, [
        ['The System Reference Document 5.1 is provided free', 10.0], // legal front matter
      ]),
      page(8, [
        ['Barbarian', 25.9], // chapter tier (class names render at chapter height)
        ['Class Features', 18.0], // section tier
        ['Rage', 13.9], // subsection tier
        ['Unarmored Defense', 12.0], // leaf tier
        ['Body prose explaining the feature.', 9.8], // body — excluded
        ['Quick Build', 10.8], // sidebar/callout tier
      ]),
    ]);
    expect(items.map((i) => [i.text, i.tier])).toEqual([
      ['Barbarian', 'chapter'],
      ['Class Features', 'section'],
      ['Rage', 'subsection'],
      ['Unarmored Defense', 'leaf'],
      ['Quick Build', 'sidebar'],
    ]);
    expect(items.every((i) => i.structure === 'heading')).toBe(true);
  });

  it('returns no items for pages without lineHeights (uniform-font fixture PDFs)', () => {
    const items = buildSourceInventory([
      { pageNumber: 1, lines: ['Spells', 'Acid Splash', 'Conjuration cantrip'] },
    ]);
    expect(items).toEqual([]);
  });

  it('records page and lineIndex provenance', () => {
    const items = buildSourceInventory([
      page(221, [
        ['Some body text', 9.8],
        ['Feather Token', 12.0],
      ]),
    ]);
    expect(items).toEqual([
      expect.objectContaining({ page: 221, lineIndex: 1, text: 'Feather Token' }),
    ]);
  });
});

describe('buildSourceInventory — wrapped heading merge', () => {
  it('merges adjacent same-tier lines into one logical heading', () => {
    const items = buildSourceInventory([
      page(221, [
        ['Figurine of Wondrous', 12.0],
        ['Power', 12.0],
        ['Wondrous item, rarity varies', 9.8],
      ]),
    ]);
    expect(texts(items)).toEqual(['Figurine of Wondrous Power']);
    expect(items[0].lineIndex).toBe(0);
  });

  it('does not merge across different tiers', () => {
    const items = buildSourceInventory([
      page(8, [
        ['Barbarian', 25.9],
        ['Class Features', 18.0],
      ]),
    ]);
    expect(texts(items)).toEqual(['Barbarian', 'Class Features']);
  });

  it('merges a heading wrapped across a page boundary', () => {
    const items = buildSourceInventory([
      page(10, [['Path of the', 13.9]]),
      page(11, [['Berserker', 13.9]]),
    ]);
    expect(texts(items)).toEqual(['Path of the Berserker']);
    expect(items[0].page).toBe(10);
  });
});

describe('buildSourceInventory — structural classification', () => {
  it('classifies a heading followed by a size/type/alignment line as a stat block', () => {
    const items = buildSourceInventory([
      page(218, [
        ['Avatar of Death', 12.0],
        ['Medium undead, neutral evil', 9.8],
        ['Armor Class 20', 9.8],
      ]),
    ]);
    expect(items[0]).toEqual(
      expect.objectContaining({ text: 'Avatar of Death', structure: 'stat-block' }),
    );
  });

  it('classifies a heading directly followed by table-cell lines as a table caption', () => {
    const items = buildSourceInventory([
      page(5, [
        ['Draconic Ancestry', 12.0],
        ['Dragon Damage Type Breath Weapon', 8.9],
        ['Black Acid 5 by 30 ft. line (Dex. save)', 8.9],
      ]),
    ]);
    expect(items[0]).toEqual(
      expect.objectContaining({ text: 'Draconic Ancestry', structure: 'table-caption' }),
    );
  });

  it('emits a caption-less table-cell run as a table-shape item with heading context', () => {
    const items = buildSourceInventory([
      page(237, [
        ['Ring of Resistance', 12.0],
        ['Ring, rare (requires attunement)', 9.8],
        ['You have resistance to one damage type.', 9.8],
        ['d10 Damage Type Gem', 8.9],
        ['1 Acid Pearl', 8.9],
        ['2 Cold Tourmaline', 8.9],
      ]),
    ]);
    expect(items).toEqual([
      expect.objectContaining({
        text: 'Ring of Resistance',
        structure: 'heading',
        tier: 'leaf',
      }),
      expect.objectContaining({
        text: 'd10 Damage Type Gem',
        structure: 'table-shape',
        tier: null,
        context: 'Ring of Resistance',
        page: 237,
        lineIndex: 3,
      }),
    ]);
  });

  it('does not double-count a caption-owned table run as a table-shape item', () => {
    const items = buildSourceInventory([
      page(5, [
        ['Draconic Ancestry', 12.0],
        ['Dragon Damage Type Breath Weapon', 8.9],
        ['Black Acid 5 by 30 ft. line (Dex. save)', 8.9],
      ]),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].structure).toBe('table-caption');
  });
});

describe('buildSourceInventory — section assignment', () => {
  it('assigns each item the nearest preceding chapter-tier heading as its section', () => {
    const items = buildSourceInventory([
      page(206, [['Magic Items', 25.9]]),
      page(221, [
        ['Feather Token', 12.0],
        ['Wondrous item, rare', 9.8],
      ]),
    ]);
    const feather = items.find((i) => i.text === 'Feather Token');
    expect(feather?.section).toBe('Magic Items');
  });

  it('gives chapter-tier items themselves a null section and null section before any chapter', () => {
    const items = buildSourceInventory([
      page(3, [['Orphan Leaf', 12.0]]),
      page(4, [['Races', 25.9]]),
    ]);
    expect(items.find((i) => i.text === 'Orphan Leaf')?.section).toBeNull();
    expect(items.find((i) => i.text === 'Races')?.section).toBeNull();
  });

  it('tracks context as the nearest preceding heading of any tier', () => {
    const items = buildSourceInventory([
      page(8, [
        ['Barbarian', 25.9],
        ['Unarmored Defense', 12.0],
        ['Body prose.', 9.8],
        ['1 Frenzied 2d6', 8.9],
        ['2 Calm 1d4', 8.9],
      ]),
    ]);
    const tableShape = items.find((i) => i.structure === 'table-shape');
    expect(tableShape?.context).toBe('Unarmored Defense');
    expect(items.find((i) => i.text === 'Barbarian')?.context).toBeNull();
  });
});
