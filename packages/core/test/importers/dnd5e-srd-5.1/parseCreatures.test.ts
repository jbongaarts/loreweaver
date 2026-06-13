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
// Category tag (loreweaver-bn0): Monsters vs Appendix MM-B Nonplayer Characters
// ---------------------------------------------------------------------------

// A representative Appendix MM-B NPC stat block (Bandit Captain). Its grammar is
// identical to a monster stat block, so the only difference is the provenance
// category the caller supplies.
const BANDIT_CAPTAIN_LINES = [
  'Bandit Captain',
  'Medium humanoid (any race), any non-lawful',
  'Armor Class 15 (studded leather)',
  'Hit Points 65 (10d8 + 20)',
  'Speed 30 ft.',
  'STR DEX CON INT WIS CHA',
  '15 (+2) 16 (+3) 14 (+2) 14 (+2) 11 (+0) 14 (+2)',
  'Challenge 2 (450 XP)',
];

describe('parseCreatures — category tag', () => {
  it("defaults the category to 'monster'", () => {
    const [goblin] = parseCreatures([page(310, GOBLIN_LINES)]);
    expect(goblin.category).toBe('monster');
  });

  it("stamps 'npc' on every extraction when the NPC category is requested", () => {
    const [captain] = parseCreatures([page(397, BANDIT_CAPTAIN_LINES)], 'npc');
    expect(captain.name).toBe('Bandit Captain');
    expect(captain.category).toBe('npc');
    // The stat block parses identically to a monster aside from the tag.
    expect(captain.armorClass).toBe(15);
    expect(captain.hitPoints).toBe(65);
    expect(captain.challengeRating).toBe('2');
    expect(captain.abilityScores.charisma).toBe(14);
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

// ---------------------------------------------------------------------------
// Keyed defensive / sense fields (eshyra-ez6v / eshyra-4a7.5)
//
// The SRD prints Saving Throws, Skills, Damage Vulnerabilities/Resistances/
// Immunities, Condition Immunities, Senses, and Languages in a fixed-order run
// between the ability-score row and the Challenge line. Each creature carries
// only the labels its source prints. Excerpts below are reproduced verbatim
// from the SRD 5.1 extracted-line shape (Aboleth p261, Deva p261-262), trait /
// action body included so the bounded scan is exercised against trailing prose.
// ---------------------------------------------------------------------------

const ABOLETH_LINES = [
  'Aboleth',
  'Large aberration, lawful evil',
  'Armor Class 17 (natural armor)',
  'Hit Points 135 (18d10 + 36)',
  'Speed 10 ft., swim 40 ft.',
  'STR DEX CON INT WIS CHA',
  '21 (+5) 9 (−1) 15 (+2) 18 (+4) 15 (+2) 18 (+4)',
  'Saving Throws Con +6, Int +8, Wis +6',
  'Skills History +12, Perception +10',
  'Senses darkvision 120 ft., passive Perception 20',
  'Languages Deep Speech, telepathy 120 ft.',
  'Challenge 10 (5,900 XP)',
  'Amphibious. The aboleth can breathe air and water.',
  'Actions',
  'Multiattack. The aboleth makes three tentacle attacks.',
];

// Deva: the SRD wraps Damage Resistances across two extracted lines, and the
// block carries Condition Immunities — neither present on the Aboleth.
const DEVA_LINES = [
  'Deva',
  'Medium celestial, lawful good',
  'Armor Class 17 (natural armor)',
  'Hit Points 136 (16d8 + 64)',
  'Speed 30 ft., fly 90 ft.',
  'STR DEX CON INT WIS CHA',
  '18 (+4) 18 (+4) 18 (+4) 17 (+3) 20 (+5) 20 (+5)',
  'Saving Throws Wis +9, Cha +9',
  'Skills Insight +9, Perception +9',
  'Damage Resistances radiant; bludgeoning, piercing,',
  'and slashing from nonmagical attacks',
  'Condition Immunities charmed, exhaustion, frightened',
  'Senses darkvision 120 ft., passive Perception 19',
  'Languages all, telepathy 120 ft.',
  'Challenge 10 (5,900 XP)',
  'Angelic Weapons. The deva’s weapon attacks are magical.',
];

describe('parseCreatures — keyed defensive / sense fields', () => {
  it('captures the full keyed run printed for the Aboleth', () => {
    const [aboleth] = parseCreatures([page(261, ABOLETH_LINES)]);
    expect(aboleth.savingThrows).toBe('Con +6, Int +8, Wis +6');
    expect(aboleth.skills).toBe('History +12, Perception +10');
    expect(aboleth.senses).toBe('darkvision 120 ft., passive Perception 20');
    expect(aboleth.languages).toBe('Deep Speech, telepathy 120 ft.');
  });

  it('leaves labels the Aboleth does not print undefined (no empty keys)', () => {
    const [aboleth] = parseCreatures([page(261, ABOLETH_LINES)]);
    expect(aboleth.damageVulnerabilities).toBeUndefined();
    expect(aboleth.damageResistances).toBeUndefined();
    expect(aboleth.damageImmunities).toBeUndefined();
    expect(aboleth.conditionImmunities).toBeUndefined();
  });

  it('does not let trait / action prose after Challenge leak into a keyed field', () => {
    const [aboleth] = parseCreatures([page(261, ABOLETH_LINES)]);
    // Languages is the last keyed line before Challenge; its value must stop at
    // the source line and not absorb the Amphibious trait below Challenge.
    expect(aboleth.languages).toBe('Deep Speech, telepathy 120 ft.');
  });

  it('re-joins a Damage Resistances value that wraps across extracted lines', () => {
    const [deva] = parseCreatures([page(261, DEVA_LINES)]);
    expect(deva.damageResistances).toBe(
      'radiant; bludgeoning, piercing, and slashing from nonmagical attacks',
    );
    expect(deva.conditionImmunities).toBe('charmed, exhaustion, frightened');
    expect(deva.savingThrows).toBe('Wis +9, Cha +9');
    expect(deva.languages).toBe('all, telepathy 120 ft.');
  });

  it('splits a next-field label the PDF merged onto the previous value line', () => {
    // Real SRD p327 (Wereboar): column flow merged "Senses passive Perception
    // 12" onto the end of the wrapped Damage Immunities value. The Senses label
    // must still split off as its own field rather than be absorbed.
    const wereboar = [
      'Wereboar',
      'Medium humanoid (human, shapechanger), neutral evil',
      'Armor Class 10 in humanoid form, 11 (natural armor)',
      'in boar or hybrid form',
      'Hit Points 78 (12d8 + 24)',
      'Speed 30 ft. (40 ft. in boar form)',
      'STR DEX CON INT WIS CHA',
      '17 (+3) 10 (+0) 15 (+2) 10 (+0) 11 (+0) 8 (−1)',
      'Skills Perception +2',
      'Damage Immunities bludgeoning, piercing, and',
      'slashing from nonmagical attacks not made with',
      'silvered weapons Senses passive Perception 12',
      'Languages Common (can’t speak in boar form)',
      'Challenge 4 (1,100 XP)',
    ];
    const [boar] = parseCreatures([page(327, wereboar)]);
    expect(boar.damageImmunities).toBe(
      'bludgeoning, piercing, and slashing from nonmagical attacks not made with silvered weapons',
    );
    expect(boar.senses).toBe('passive Perception 12');
    expect(boar.languages).toBe('Common (can’t speak in boar form)');
  });

  it('accepts the singular "Damage Resistance" label a conditional block prints', () => {
    // Real SRD p395 (Archmage): the stoneskin conditional is printed as singular
    // "Damage Resistance"; it must map to damageResistances, not be swallowed by
    // the preceding Skills value.
    const archmage = [
      'Archmage',
      'Medium humanoid (any race), any alignment',
      'Armor Class 12 (15 with mage armor)',
      'Hit Points 99 (18d8 + 18)',
      'Speed 30 ft.',
      'STR DEX CON INT WIS CHA',
      '10 (+0) 14 (+2) 12 (+1) 20 (+5) 15 (+2) 16 (+3)',
      'Saving Throws Int +9, Wis +6',
      'Skills Arcana +13, History +13',
      'Damage Resistance damage from spells; nonmagical',
      'bludgeoning, piercing, and slashing (from stoneskin)',
      'Senses passive Perception 12',
      'Languages any six languages',
      'Challenge 12 (8,400 XP)',
    ];
    const [mage] = parseCreatures([page(395, archmage)], 'npc');
    expect(mage.skills).toBe('Arcana +13, History +13');
    expect(mage.damageResistances).toBe(
      'damage from spells; nonmagical bludgeoning, piercing, and slashing (from stoneskin)',
    );
    expect(mage.senses).toBe('passive Perception 12');
  });

  it('captures keyed fields on an NPC stat block the same way', () => {
    // The Bandit Captain prints no defensive/sense run beyond what its block
    // carries; a beast-simple block (Black Bear) has only Skills/Senses/Languages.
    const [bear] = parseCreatures([page(318, BLACK_BEAR_LINES)]);
    expect(bear.skills).toBe('Perception +3');
    expect(bear.senses).toBe('passive Perception 13');
    expect(bear.languages).toBe('—');
    expect(bear.savingThrows).toBeUndefined();
  });
});
