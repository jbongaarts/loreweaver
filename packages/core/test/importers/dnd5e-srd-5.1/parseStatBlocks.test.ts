/**
 * Inline stat-block parser unit tests for the D&D 5e SRD 5.1 importer
 * (eshyra-4a7.4).
 *
 * Stat-block excerpts in this file are reproduced from the System Reference
 * Document 5.1 by Wizards of the Coast LLC, available under the Creative Commons
 * Attribution 4.0 International License (CC-BY-4.0). Excerpts are used as parser
 * test input; no modification has been made beyond reformatting to match the
 * importer's extracted-line input shape (the STR/DEX/… ability table is split
 * into a header line and a scores line, as pdfjs extracts it, and a prose line
 * from the adjacent two-column body is interleaved to mirror the real PDF).
 */

import { describe, expect, it } from 'vitest';
import { parseStatBlocks } from '../../../scripts/importers/dnd5e-srd-5.1/parseStatBlocks.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

// Avatar of Death (SRD p218, inside the Deck of Many Things). Abbreviated: its
// Hit Points line is DERIVED prose, not an integer, and its Challenge prints as
// an em dash. A two-column prose line is interleaved between the STR/DEX header
// and the score row to mirror the real extraction.
const AVATAR_OF_DEATH_LINES = [
  'Avatar of Death',
  'Medium undead, neutral evil',
  'Armor Class 20',
  'Hit Points half the hit point maximum of its summoner',
  'Speed 60 ft., fly 60 ft. (hover)',
  'STR DEX CON INT WIS CHA',
  'this way, your body is incapacitated. A wish spell',
  '16 (+3) 16 (+3) 16 (+3) 16 (+3) 16 (+3) 16 (+3)',
  'Damage Immunities necrotic, poison',
  'Senses darkvision 60 ft., truesight 60 ft., passive Perception 13',
  'Languages all languages known to its summoner',
  'Challenge — (0 XP)',
  'Incorporeal Movement. The avatar can move through other creatures and objects as if they were difficult terrain.',
  'It takes 5 (1d10) force damage if it ends its turn inside an object.',
  'Turning Immunity. The avatar is immune to features that turn undead.',
  'Actions',
  'Reaping Scythe. The avatar sweeps its spectral scythe through a creature within 5 feet of it, dealing 7 (1d8 +',
  '3) slashing damage plus 4 (1d8) necrotic damage.',
];

// Giant Fly (SRD p222, inside the Figurine of Wondrous Power). Abbreviated: a
// fixed Hit Points value WITH a dice formula, and NO Challenge line at all.
const GIANT_FLY_LINES = [
  'Giant Fly',
  'Large beast, unaligned',
  'Armor Class 11',
  'Hit Points 19 (3d10 + 3)',
  'Speed 30 ft., fly 60 ft.',
  'STR DEX CON INT WIS CHA',
  'hours. The nightmare fights only to defend itself.',
  '14 (+2) 13 (+1) 13 (+1) 2 (−4) 10 (+0) 3 (−4)',
  'Senses darkvision 60 ft., passive Perception 10',
  'Languages —',
];

// An ordinary monster stat block that must NOT be re-emitted as a stat-block:
// it is owned by parseCreatures and passed in via `excludeNames`.
const GOBLIN_LINES = [
  'Goblin',
  'Small humanoid (goblinoid), neutral evil',
  'Armor Class 15 (leather armor, shield)',
  'Hit Points 7 (2d6)',
  'Speed 30 ft.',
  'STR DEX CON INT WIS CHA',
  '8 (−1) 14 (+2) 10 (+0) 10 (+0) 8 (−1) 8 (−1)',
  'Challenge 1/4 (50 XP)',
];

const CONTAINING_ITEMS = new Map<string, string>([
  ['Avatar of Death', 'Deck of Many Things'],
  ['Giant Fly', 'Figurine of Wondrous Power'],
]);

describe('parseStatBlocks', () => {
  it('emits Avatar of Death with derived (special) hit points and no challenge rating', () => {
    const result = parseStatBlocks([page(218, AVATAR_OF_DEATH_LINES)], {
      excludeNames: new Set(),
      containingItemByName: CONTAINING_ITEMS,
    });
    expect(result).toHaveLength(1);
    const avatar = result[0];
    expect(avatar.name).toBe('Avatar of Death');
    expect(avatar.size).toBe('Medium');
    expect(avatar.type).toBe('undead');
    expect(avatar.alignment).toBe('neutral evil');
    expect(avatar.armorClass).toBe(20);
    expect(avatar.hitPoints).toEqual({
      special: 'half the hit point maximum of its summoner',
    });
    expect(avatar.damageImmunities).toBe('necrotic, poison');
    expect(avatar.senses).toBe(
      'darkvision 60 ft., truesight 60 ft., passive Perception 13',
    );
    expect(avatar.languages).toBe('all languages known to its summoner');
    // The "—" CR token is preserved verbatim with its XP, not dropped.
    expect(avatar.challengeRating).toBe('—');
    expect(avatar.experiencePoints).toBe(0);
    expect(avatar.traits).toEqual([
      {
        name: 'Incorporeal Movement',
        text: 'The avatar can move through other creatures and objects as if they were difficult terrain. It takes 5 (1d10) force damage if it ends its turn inside an object.',
      },
      {
        name: 'Turning Immunity',
        text: 'The avatar is immune to features that turn undead.',
      },
    ]);
    expect(avatar.actions).toEqual([
      {
        name: 'Reaping Scythe',
        text: 'The avatar sweeps its spectral scythe through a creature within 5 feet of it, dealing 7 (1d8 + 3) slashing damage plus 4 (1d8) necrotic damage.',
      },
    ]);
    expect(avatar.speed).toEqual({ walk: 60, fly: 60 });
    expect(avatar.abilityScores).toEqual({
      strength: 16,
      dexterity: 16,
      constitution: 16,
      intelligence: 16,
      wisdom: 16,
      charisma: 16,
    });
    expect(avatar.containingItem).toBe('Deck of Many Things');
    expect(avatar.sourcePage).toBe(218);
  });

  it('emits Giant Fly with a fixed hit-point value + formula and no challenge rating', () => {
    const result = parseStatBlocks([page(222, GIANT_FLY_LINES)], {
      excludeNames: new Set(),
      containingItemByName: CONTAINING_ITEMS,
    });
    expect(result).toHaveLength(1);
    const fly = result[0];
    expect(fly.name).toBe('Giant Fly');
    expect(fly.hitPoints).toEqual({ value: 19, formula: '3d10 + 3' });
    expect(fly.senses).toBe('darkvision 60 ft., passive Perception 10');
    expect(fly.languages).toBe('—');
    // Giant Fly has no Challenge line; nothing must be invented for it.
    expect(fly.challengeRating).toBeUndefined();
    expect(fly.experiencePoints).toBeUndefined();
    expect(fly.speed).toEqual({ walk: 30, fly: 60 });
    expect(fly.containingItem).toBe('Figurine of Wondrous Power');
    expect(fly.sourcePage).toBe(222);
  });

  it('detects both inline blocks across a document and returns them sorted by name', () => {
    const result = parseStatBlocks(
      [page(218, AVATAR_OF_DEATH_LINES), page(222, GIANT_FLY_LINES)],
      { excludeNames: new Set(), containingItemByName: CONTAINING_ITEMS },
    );
    expect(result.map((s) => s.name)).toEqual(['Avatar of Death', 'Giant Fly']);
  });

  it('skips creatures already emitted by parseCreatures (excludeNames)', () => {
    // The Goblin block is a full creature owned by parseCreatures; it must not
    // be re-emitted as an inline stat block even though it parses as one.
    const result = parseStatBlocks(
      [page(254, GOBLIN_LINES), page(218, AVATAR_OF_DEATH_LINES)],
      {
        excludeNames: new Set(['Goblin']),
        containingItemByName: CONTAINING_ITEMS,
      },
    );
    expect(result.map((s) => s.name)).toEqual(['Avatar of Death']);
  });

  it('fails closed on a confirmed inline block missing from the reviewed containing-item map', () => {
    // A novel inline stat block the importer has never reviewed must not emit an
    // unattributed record — it stops the run for review.
    expect(() =>
      parseStatBlocks([page(218, AVATAR_OF_DEATH_LINES)], {
        excludeNames: new Set(),
        containingItemByName: new Map(),
      }),
    ).toThrow(/not in the reviewed containing-item map/);
  });

  it('recovers wrapped keyed values from the containing item clean text', () => {
    // In the raw two-column lines Avatar of Death's Condition Immunities and
    // Senses wrap across interleaved column prose, so per-line parsing would
    // truncate them. parseMagicItems has already reflowed the Deck of Many Things
    // description into clean contiguous text; cleanTextByName feeds it back so the
    // full values are recovered.
    const wrappedRaw = [
      'Avatar of Death',
      'Medium undead, neutral evil',
      'Armor Class 20',
      'Hit Points half the hit point maximum of its summoner',
      'Speed 60 ft., fly 60 ft. (hover)',
      'STR DEX CON INT WIS CHA',
      '16 (+3) 16 (+3) 16 (+3) 16 (+3) 16 (+3) 16 (+3)',
      'Condition Immunities charmed, frightened, paralyzed,', // wraps below
      'petrified, poisoned, unconscious',
    ];
    const cleanText =
      'Avatar of Death Medium undead, neutral evil Armor Class 20 ' +
      'Hit Points half the hit point maximum of its summoner ' +
      'Speed 60 ft., fly 60 ft. (hover) STR DEX CON INT WIS CHA ' +
      '16 (+3) 16 (+3) 16 (+3) 16 (+3) 16 (+3) 16 (+3) ' +
      'Damage Immunities necrotic, poison ' +
      'Condition Immunities charmed, frightened, paralyzed, petrified, poisoned, unconscious ' +
      'Senses darkvision 60 ft., truesight 60 ft., passive Perception 13 ' +
      'Languages all languages known to its summoner Challenge — (0 XP) ' +
      'Incorporeal Movement. The avatar can move through other creatures.';
    const result = parseStatBlocks([page(218, wrappedRaw)], {
      excludeNames: new Set(),
      containingItemByName: CONTAINING_ITEMS,
      cleanTextByName: new Map([['Avatar of Death', cleanText]]),
    });
    expect(result).toHaveLength(1);
    expect(result[0].conditionImmunities).toBe(
      'charmed, frightened, paralyzed, petrified, poisoned, unconscious',
    );
    expect(result[0].senses).toBe(
      'darkvision 60 ft., truesight 60 ft., passive Perception 13',
    );
  });

  it('does not mistake a distant "Challenge Rating" line for a challenge value', () => {
    // Giant Fly has no Challenge line; a far-off Monsters-chapter "Challenge
    // Rating" heading in the body window must not be read as its CR.
    const fly = page(222, [
      ...GIANT_FLY_LINES,
      ...Array(30).fill('filler line of unrelated figurine prose'),
      'Challenge Rating', // distant heading, not a real CR line
    ]);
    const result = parseStatBlocks([fly], {
      excludeNames: new Set(),
      containingItemByName: CONTAINING_ITEMS,
    });
    expect(result[0].challengeRating).toBeUndefined();
  });

  it('ignores prose that merely resembles a meta line (no stat-block signature)', () => {
    const prose = page(100, [
      'Large beasts',
      'Large beasts, such as horses, are common mounts.',
      'They can carry heavy loads across long distances.',
    ]);
    const result = parseStatBlocks([prose], {
      excludeNames: new Set(),
      containingItemByName: CONTAINING_ITEMS,
    });
    expect(result).toEqual([]);
  });
});
