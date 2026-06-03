/**
 * Creature-parser unit tests for the D&D 5e SRD 5.1 importer.
 *
 * Creature stat-block excerpts in this file are reproduced from the System
 * Reference Document 5.1 by Wizards of the Coast LLC, available under the
 * Creative Commons Attribution 4.0 International License (CC-BY-4.0). Excerpts
 * are used as parser test input; no modification has been made beyond
 * reformatting to match the importer's extracted-line input shape (the
 * STR/DEX/… ability table is split into a header line and a scores line, as
 * pdfjs extracts it).
 */

import { describe, expect, it } from 'vitest';
import { parseCreatures } from '../../../scripts/importers/dnd5e-srd-5.1/parseCreatures.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

// ---------------------------------------------------------------------------
// SRD 5.1 representative stat blocks. Note the Unicode minus (−) in modifiers,
// matching the real PDF; only the leading score is read by the parser.
// ---------------------------------------------------------------------------

// Small humanoid.
const GOBLIN_LINES = [
  'Goblin',
  'Small humanoid (goblinoid), neutral evil',
  'Armor Class 15 (leather armor, shield)',
  'Hit Points 7 (2d6)',
  'Speed 30 ft.',
  'STR DEX CON INT WIS CHA',
  '8 (−1) 14 (+2) 10 (+0) 10 (+0) 8 (−1) 8 (−1)',
  'Skills Stealth +6',
  'Senses darkvision 60 ft., passive Perception 9',
  'Languages Common, Goblin',
  'Challenge 1/4 (50 XP)',
  'Nimble Escape. The goblin can take the Disengage or Hide action as a bonus',
  'action on each of its turns.',
  'ACTIONS',
  'Scimitar. Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5',
  '(1d6 + 2) slashing damage.',
];

// Medium beast — exercises a multi-mode speed (walk + climb) and ASCII-hyphen
// modifiers.
const BLACK_BEAR_LINES = [
  'Black Bear',
  'Medium beast, unaligned',
  'Armor Class 11 (natural armor)',
  'Hit Points 19 (3d8 + 6)',
  'Speed 40 ft., climb 30 ft.',
  'STR DEX CON INT WIS CHA',
  '15 (+2) 10 (+0) 14 (+2) 2 (-4) 12 (+1) 7 (-2)',
  'Skills Perception +3',
  'Senses passive Perception 13',
  'Languages —',
  'Challenge 1/2 (100 XP)',
];

// Large dragon — exercises a flying speed and an integer challenge rating.
const WYVERN_LINES = [
  'Wyvern',
  'Large dragon, unaligned',
  'Armor Class 13 (natural armor)',
  'Hit Points 110 (13d10 + 39)',
  'Speed 20 ft., fly 80 ft.',
  'STR DEX CON INT WIS CHA',
  '19 (+4) 10 (+0) 16 (+3) 5 (−3) 12 (+1) 6 (−2)',
  'Senses darkvision 60 ft., passive Perception 11',
  'Languages —',
  'Challenge 6 (2,300 XP)',
];

// ---------------------------------------------------------------------------
// Single creature: Goblin (small humanoid)
// ---------------------------------------------------------------------------

describe('parseCreatures — Goblin (small humanoid)', () => {
  const [goblin] = parseCreatures([page(310, GOBLIN_LINES)]);

  it('extracts exactly one creature', () => {
    expect(parseCreatures([page(310, GOBLIN_LINES)])).toHaveLength(1);
  });

  it('extracts the name and records the source page', () => {
    expect(goblin.name).toBe('Goblin');
    expect(goblin.sourcePage).toBe(310);
  });

  it('parses size, type (with parenthetical subtype preserved), and alignment', () => {
    expect(goblin.size).toBe('Small');
    // The "(goblinoid)" race/subtype qualifier is retained on the type
    // (loreweaver-2ze) rather than collapsed to a bare "humanoid".
    expect(goblin.type).toBe('humanoid (goblinoid)');
    expect(goblin.alignment).toBe('neutral evil');
  });

  it('parses the leading integers of AC and HP', () => {
    expect(goblin.armorClass).toBe(15);
    expect(goblin.hitPoints).toBe(7);
  });

  it('parses an unlabeled base speed as walk', () => {
    expect(goblin.speed).toEqual({ walk: 30 });
  });

  it('parses the challenge rating without the XP parenthetical', () => {
    expect(goblin.challengeRating).toBe('1/4');
  });

  it('parses all six ability scores (score, not modifier)', () => {
    expect(goblin.abilityScores).toEqual({
      strength: 8,
      dexterity: 14,
      constitution: 10,
      intelligence: 10,
      wisdom: 8,
      charisma: 8,
    });
  });
});

// ---------------------------------------------------------------------------
// Medium beast: Black Bear — multi-mode speed, ASCII-hyphen modifiers
// ---------------------------------------------------------------------------

describe('parseCreatures — Black Bear (medium beast)', () => {
  const [bear] = parseCreatures([page(318, BLACK_BEAR_LINES)]);

  it('parses size and type', () => {
    expect(bear.size).toBe('Medium');
    expect(bear.type).toBe('beast');
    expect(bear.alignment).toBe('unaligned');
  });

  it('parses a labeled secondary speed mode', () => {
    expect(bear.speed).toEqual({ walk: 40, climb: 30 });
  });

  it('parses HP with a dice + bonus expression', () => {
    expect(bear.hitPoints).toBe(19);
  });

  it('parses scores with ASCII-hyphen modifiers', () => {
    expect(bear.abilityScores.intelligence).toBe(2);
    expect(bear.abilityScores.charisma).toBe(7);
  });

  it('parses a fractional challenge rating', () => {
    expect(bear.challengeRating).toBe('1/2');
  });
});

// ---------------------------------------------------------------------------
// Large dragon: Wyvern — flying speed, integer CR
// ---------------------------------------------------------------------------

describe('parseCreatures — Wyvern (large dragon)', () => {
  const [wyvern] = parseCreatures([page(360, WYVERN_LINES)]);

  it('parses size and type', () => {
    expect(wyvern.size).toBe('Large');
    expect(wyvern.type).toBe('dragon');
  });

  it('parses a flying speed mode alongside the base walk speed', () => {
    expect(wyvern.speed).toEqual({ walk: 20, fly: 80 });
  });

  it('parses a large hit-point total', () => {
    expect(wyvern.hitPoints).toBe(110);
  });

  it('parses an integer challenge rating', () => {
    expect(wyvern.challengeRating).toBe('6');
  });
});

// ---------------------------------------------------------------------------
// Multiple creatures on one page
// ---------------------------------------------------------------------------

describe('parseCreatures — multiple stat blocks on one page', () => {
  const results = parseCreatures([
    page(310, [...GOBLIN_LINES, '', ...BLACK_BEAR_LINES, '', ...WYVERN_LINES]),
  ]);

  it('extracts all three creatures', () => {
    expect(results).toHaveLength(3);
  });

  it('returns creatures sorted by name', () => {
    expect(results.map((c) => c.name)).toEqual([
      'Black Bear',
      'Goblin',
      'Wyvern',
    ]);
  });

  it('does not bleed one stat block into another', () => {
    const bear = results.find((c) => c.name === 'Black Bear');
    const goblin = results.find((c) => c.name === 'Goblin');
    const wyvern = results.find((c) => c.name === 'Wyvern');
    expect(bear?.type).toBe('beast');
    expect(goblin?.type).toBe('humanoid (goblinoid)');
    expect(wyvern?.type).toBe('dragon');
    // Ability scores must come from each creature's own block.
    expect(goblin?.abilityScores.strength).toBe(8);
    expect(bear?.abilityScores.strength).toBe(15);
    expect(wyvern?.abilityScores.strength).toBe(19);
    // AC must not be shared from the first block.
    expect(bear?.armorClass).toBe(11);
    expect(wyvern?.armorClass).toBe(13);
  });
});

// ---------------------------------------------------------------------------
// Creatures spanning multiple pages
// ---------------------------------------------------------------------------

describe('parseCreatures — stat blocks spanning multiple pages', () => {
  it('assigns sourcePage from the page the meta line appears on', () => {
    const results = parseCreatures([
      page(310, GOBLIN_LINES),
      page(318, BLACK_BEAR_LINES),
    ]);
    expect(results).toHaveLength(2);
    expect(results.find((c) => c.name === 'Goblin')?.sourcePage).toBe(310);
    expect(results.find((c) => c.name === 'Black Bear')?.sourcePage).toBe(318);
  });
});

// ---------------------------------------------------------------------------
// Defense-in-depth: meta-like prose without a stat block is not a creature
// ---------------------------------------------------------------------------

describe('parseCreatures — non-creature input', () => {
  it('returns empty array for empty page list', () => {
    expect(parseCreatures([])).toEqual([]);
  });

  it('skips a meta-like sentence with no stat-block signature', () => {
    // "Large beasts, such as horses, …" parses as a meta line, but no Armor
    // Class / Hit Points / ability table follows, so it must be skipped.
    const p = page(1, [
      'The Plains',
      'Large beasts, such as horses, roam the open grasslands.',
      'They are not a threat to a well-armed party.',
    ]);
    expect(parseCreatures([p])).toEqual([]);
  });

  it('ignores trailing non-creature prose after the last stat block', () => {
    const p = page(310, [
      ...GOBLIN_LINES,
      '',
      'Nonplayer Characters',
      'The following NPCs are described in prose, not stat blocks.',
    ]);
    const results = parseCreatures([p]);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Goblin');
  });
});

// ---------------------------------------------------------------------------
// Fail loud on a confirmed-but-malformed stat block
// ---------------------------------------------------------------------------

describe('parseCreatures — malformed confirmed stat block', () => {
  it('throws when a confirmed creature is missing its Challenge line', () => {
    const noChallenge = GOBLIN_LINES.filter(
      (l) => l.startsWith('Challenge') === false,
    );
    expect(() => parseCreatures([page(310, noChallenge)])).toThrow(
      /Goblin.*Challenge/,
    );
  });
});

// ---------------------------------------------------------------------------
// Real-PDF resilience (loreweaver-w8h)
// ---------------------------------------------------------------------------

describe('parseCreatures — real-PDF resilience', () => {
  it('parses ability scores even when prose from the adjacent column lands between the STR/DEX header and the score row', () => {
    // Reproduces the real SRD page 268 (Cloaker) shape: column-aware extraction
    // emits the right-column score row separated from its header by a
    // left-column body line. Before w8h the parser only looked at the line
    // immediately after the header and silently dropped the stat block.
    const cloaker = [
      'Cloaker',
      'Large aberration, chaotic neutral',
      'Armor Class 14 (natural armor)',
      'Hit Points 78 (12d10 + 12)',
      'Speed 10 ft., fly 40 ft.',
      'STR DEX CON INT WIS CHA',
      'attack or a harmful spell while a duplicate remains,',
      '17 (+3) 15 (+2) 12 (+1) 13 (+1) 12 (+1) 14 (+2)',
      'Skills Stealth +5',
      'Senses darkvision 60 ft., passive Perception 11',
      'Languages Deep Speech, Undercommon',
      'Challenge 8 (3,900 XP)',
    ];
    const results = parseCreatures([page(268, cloaker)]);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Cloaker');
    expect(results[0].abilityScores.strength).toBe(17);
    expect(results[0].abilityScores.dexterity).toBe(15);
    expect(results[0].abilityScores.charisma).toBe(14);
  });

  it('normalizes soft hyphens and U+2010 in compound creature names so PDF presentation marks do not drop the stat block', () => {
    // Reproduces the real SRD page 388 (Saber-Toothed Tiger) shape: the
    // compound name carries an ASCII hyphen + U+00AD soft hyphen + U+2010
    // Unicode HYPHEN, which renders as one hyphen but breaks the name's
    // character-class check. Before w8h these stat blocks (Will-o'-Wisp,
    // Half-Red Dragon Veteran, Saber-Toothed Tiger) were silently dropped.
    const saberTooth = [
      'Saber-\u00AD\u2010Toothed Tiger',
      'Large beast, unaligned',
      'Armor Class 12',
      'Hit Points 52 (7d10 + 14)',
      'Speed 40 ft.',
      'STR DEX CON INT WIS CHA',
      '18 (+4) 14 (+2) 15 (+2) 3 (−4) 12 (+1) 8 (−1)',
      'Senses passive Perception 13',
      'Languages —',
      'Challenge 2 (450 XP)',
    ];
    const [tiger] = parseCreatures([page(388, saberTooth)]);
    expect(tiger.name).toBe('Saber-Toothed Tiger');
    expect(tiger.size).toBe('Large');
    expect(tiger.type).toBe('beast');
  });
});
