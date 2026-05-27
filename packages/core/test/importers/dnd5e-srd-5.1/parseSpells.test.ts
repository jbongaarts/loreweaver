/**
 * Spell-parser unit tests for the D&D 5e SRD 5.1 importer.
 *
 * Spell text excerpts in this file are reproduced from the System Reference
 * Document 5.1 by Wizards of the Coast LLC, available under the Creative
 * Commons Attribution 4.0 International License (CC-BY-4.0). Excerpts are
 * used here as parser test input; no modification of the rules content has
 * been made beyond reformatting to match the importer's extracted-line input
 * shape (one PDF visual line per array entry).
 */

import { describe, expect, it } from 'vitest';
import {
  applyClassLists,
  parseSpellClassLists,
  parseSpells,
} from '../../../scripts/importers/dnd5e-srd-5.1/parseSpells.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

// ---------------------------------------------------------------------------
// Cantrip: Acid Splash. Verbatim SRD 5.1.
// ---------------------------------------------------------------------------

const ACID_SPLASH_PAGE = page(211, [
  'Acid Splash',
  'Conjuration cantrip',
  'Casting Time: 1 action',
  'Range: 60 feet',
  'Components: V, S',
  'Duration: Instantaneous',
  'You hurl a bubble of acid. Choose one creature you can',
  'see within range, or choose two creatures you can see',
  'within range that are within 5 feet of each other. A target',
  'must succeed on a Dexterity saving throw or take 1d6',
  'acid damage.',
  "This spell's damage increases by 1d6 when you reach",
  '5th level (2d6), 11th level (3d6), and 17th level (4d6).',
]);

// ---------------------------------------------------------------------------
// 1st-level with "At Higher Levels": Magic Missile.
// ---------------------------------------------------------------------------

const MAGIC_MISSILE_PAGE = page(257, [
  'Magic Missile',
  '1st-level evocation',
  'Casting Time: 1 action',
  'Range: 120 feet',
  'Components: V, S',
  'Duration: Instantaneous',
  'You create three glowing darts of magical force. Each',
  'dart hits a creature of your choice that you can see',
  'within range. A dart deals 1d4 + 1 force damage to its',
  'target. The darts all strike simultaneously, and you can',
  'direct them to hit one creature or several.',
  'At Higher Levels. When you cast this spell using a',
  'spell slot of 2nd level or higher, the spell creates one',
  'more dart for each slot level above 1st.',
]);

// ---------------------------------------------------------------------------
// 2nd-level with material components text: Aid.
// ---------------------------------------------------------------------------

const AID_PAGE = page(211, [
  'Aid',
  '2nd-level abjuration',
  'Casting Time: 1 action',
  'Range: 30 feet',
  'Components: V, S, M (a tiny strip of white cloth)',
  'Duration: 8 hours',
  'Your spell bolsters your allies with toughness and',
  'resolve. Choose up to three creatures within range.',
  "Each target's hit point maximum and current hit points",
  'increase by 5 for the duration.',
  'At Higher Levels. When you cast this spell using a spell',
  "slot of 3rd level or higher, a target's hit points increase by",
  'an additional 5 for each slot level above 2nd.',
]);

describe('parseSpells — cantrip without material components', () => {
  const [spell] = parseSpells([ACID_SPLASH_PAGE]);

  it('extracts the spell name', () => {
    expect(spell.name).toBe('Acid Splash');
  });

  it('marks level=0 for a cantrip', () => {
    expect(spell.level).toBe(0);
  });

  it('captures the school in lowercase', () => {
    expect(spell.school).toBe('conjuration');
  });

  it('captures the keyed metadata fields', () => {
    expect(spell.castingTime).toBe('1 action');
    expect(spell.range).toBe('60 feet');
    expect(spell.components).toEqual(['V', 'S']);
    expect(spell.duration).toBe('Instantaneous');
  });

  it('leaves componentMaterials undefined when none are listed', () => {
    expect(spell.componentMaterials).toBeUndefined();
  });

  it('captures a description that re-flows wrapped lines', () => {
    expect(spell.description).toMatch(/^You hurl a bubble of acid\./);
    // Wrapped lines collapse to a single space, not a literal newline.
    expect(spell.description).not.toContain('\nsee within');
  });

  it('leaves higherLevels undefined for SRD 5.1 cantrip upgrade text (no marker)', () => {
    // SRD 5.1 cantrips state their per-level damage scaling as a regular
    // description paragraph with no "At Higher Levels." or "Cantrip Upgrade."
    // header. The parser only splits higherLevels on those literal markers,
    // so cantrip scaling stays in description.
    expect(spell.higherLevels).toBeUndefined();
    expect(spell.description).toMatch(/damage increases by 1d6 when you reach/);
  });

  it('records the source page', () => {
    expect(spell.sourcePage).toBe(211);
  });
});

describe('parseSpells — leveled spell with At Higher Levels', () => {
  const [spell] = parseSpells([MAGIC_MISSILE_PAGE]);

  it('extracts level=1 from "1st-level"', () => {
    expect(spell.level).toBe(1);
  });

  it('captures the school', () => {
    expect(spell.school).toBe('evocation');
  });

  it('splits description vs. higherLevels at "At Higher Levels."', () => {
    expect(spell.description).toMatch(/^You create three glowing darts/);
    expect(spell.description).not.toMatch(/At Higher Levels/);
    expect(spell.higherLevels).toMatch(/^When you cast this spell/);
  });
});

describe('parseSpells — material-component spell', () => {
  const [spell] = parseSpells([AID_PAGE]);

  it('extracts the V/S/M component list without the material text', () => {
    expect(spell.components).toEqual(['V', 'S', 'M']);
  });

  it('captures the material component text separately', () => {
    expect(spell.componentMaterials).toBe('a tiny strip of white cloth');
  });

  it('captures level=2 and abjuration school', () => {
    expect(spell.level).toBe(2);
    expect(spell.school).toBe('abjuration');
  });
});

describe('parseSpells — multiple spells across one page', () => {
  it('extracts both spells in alphabetical order', () => {
    const merged = page(211, [
      ...MAGIC_MISSILE_PAGE.lines,
      '',
      ...ACID_SPLASH_PAGE.lines,
    ]);
    const spells = parseSpells([merged]);
    expect(spells.map((s) => s.name)).toEqual(['Acid Splash', 'Magic Missile']);
  });

  it('does not bleed description from one spell into the next', () => {
    const merged = page(211, [
      ...MAGIC_MISSILE_PAGE.lines,
      '',
      ...ACID_SPLASH_PAGE.lines,
    ]);
    const [acid, magicMissile] = parseSpells([merged]);
    expect(acid.description).not.toMatch(/magical force/);
    expect(magicMissile.description).not.toMatch(/bubble of acid/);
  });
});

describe('parseSpells — output ordering', () => {
  it('returns spells sorted by name', () => {
    const spells = parseSpells([
      MAGIC_MISSILE_PAGE,
      ACID_SPLASH_PAGE,
      AID_PAGE,
    ]);
    const names = spells.map((s) => s.name);
    expect(names).toEqual([...names].sort());
  });
});

describe('parseSpellClassLists', () => {
  it('extracts spell names per caster class', () => {
    const classListPage: PageText = page(289, [
      'Wizard Spells',
      'Cantrips (0 Level)',
      'Acid Splash',
      'Fire Bolt',
      '',
      '1st Level',
      'Magic Missile',
      '',
      'Sorcerer Spells',
      'Cantrips (0 Level)',
      'Acid Splash',
      'Fire Bolt',
      '',
      '1st Level',
      'Magic Missile',
    ]);
    const index = parseSpellClassLists([classListPage]);
    expect([...(index.get('Acid Splash') ?? new Set())].sort()).toEqual([
      'Sorcerer',
      'Wizard',
    ]);
    expect([...(index.get('Magic Missile') ?? new Set())].sort()).toEqual([
      'Sorcerer',
      'Wizard',
    ]);
  });

  it('returns an empty index when no class headers are found', () => {
    const noClassPage = page(1, ['Acid Splash', 'Conjuration cantrip']);
    const index = parseSpellClassLists([noClassPage]);
    expect(index.size).toBe(0);
  });
});

describe('applyClassLists', () => {
  it('returns a stable, sorted class list for each spell', () => {
    const classListPage: PageText = page(289, [
      'Wizard Spells',
      'Cantrips (0 Level)',
      'Acid Splash',
      '',
      'Sorcerer Spells',
      'Cantrips (0 Level)',
      'Acid Splash',
    ]);
    const index = parseSpellClassLists([classListPage]);
    const spells = parseSpells([ACID_SPLASH_PAGE]);
    const { classes } = applyClassLists(spells, index);
    expect(classes.get('Acid Splash')).toEqual(['Sorcerer', 'Wizard']);
  });

  it('returns an empty array for spells not in any class list', () => {
    const empty: PageText = page(1, []);
    const index = parseSpellClassLists([empty]);
    const spells = parseSpells([ACID_SPLASH_PAGE]);
    const { classes } = applyClassLists(spells, index);
    expect(classes.get('Acid Splash')).toEqual([]);
  });
});
