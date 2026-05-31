/**
 * End-to-end pipeline test for the D&D 5e SRD 5.1 importer.
 *
 * Generates a small fixture PDF at test time using pdfkit (so no binary
 * fixture has to live in the repo), runs the full importer (extract → parse
 * → emit), and round-trips through `loadRulesPackFromDirectory` to confirm
 * the produced files load and validate.
 *
 * The fixture PDF mimics the SRD layout closely enough to exercise the
 * spell-stat-block parser and the class-spell-list parser, but is much
 * smaller than the real SRD. The full SRD PDF is the responsibility of
 * `loreweaver-0m9.6`'s coverage tests once vendored.
 */

import { createWriteStream, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ClassCoverageError,
  CreatureCoverageError,
  runImporter,
  SubclassCoverageError,
} from '../../../scripts/importers/dnd5e-srd-5.1/index.js';
import { SectionNotFoundError } from '../../../scripts/importers/dnd5e-srd-5.1/sections.js';
import { loadRulesPackFromDirectory } from '../../../src/internal.js';

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'srd-importer-pipeline-'));
  tmpDirs.push(dir);
  return dir;
}

interface FixtureLine {
  readonly text: string;
  /** Optional explicit gap before this line. */
  readonly leadingGap?: number;
}

interface FixturePage {
  readonly lines: ReadonlyArray<string | FixtureLine>;
}

async function writeFixturePdf(
  filePath: string,
  pages: readonly FixturePage[],
): Promise<void> {
  // size: LETTER (612 x 792 pt), small margins so we fit ~50 lines per page.
  const doc = new PDFDocument({
    size: 'LETTER',
    margin: 40,
    autoFirstPage: false,
  });
  const stream = createWriteStream(filePath);
  doc.pipe(stream);
  doc.font('Helvetica').fontSize(11);

  pages.forEach((page, i) => {
    doc.addPage();
    for (const entry of page.lines) {
      if (typeof entry === 'string') {
        doc.text(entry);
      } else {
        if (entry.leadingGap !== undefined && entry.leadingGap > 0) {
          doc.moveDown(entry.leadingGap);
        }
        doc.text(entry.text);
      }
    }
    // Mark page i+1 explicitly (we don't read this; the parser uses
    // PageText.pageNumber from extract.ts, which counts pages in order).
    void i;
  });

  doc.end();
  await new Promise<void>((resolve, reject) => {
    stream.on('finish', () => resolve());
    stream.on('error', reject);
  });
}

// The fixture deliberately mirrors the SRD 5.1 chapter ordering: spell-lists
// chapter precedes spell-descriptions chapter. Default section anchors
// (`SRD_5_1_DEFAULT_SECTION_ANCHORS`) discriminate the two by exact heading
// match.
const SPELL_LISTS_PAGE: FixturePage = {
  lines: [
    'Spell Lists',
    'Wizard Spells',
    'Cantrips (0 Level)',
    'Acid Splash',
    '',
    '1st Level',
    'Magic Missile',
    '',
    'Sorcerer Spells',
    'Cantrips (0 Level)',
    'Acid Splash',
    '',
    '1st Level',
    'Magic Missile',
  ],
};

const SPELLS_PAGE: FixturePage = {
  lines: [
    'Spells',
    'Acid Splash',
    'Conjuration cantrip',
    'Casting Time: 1 action',
    'Range: 60 feet',
    'Components: V, S',
    'Duration: Instantaneous',
    'You hurl a bubble of acid. Choose one creature you can see within range.',
    '',
    'Magic Missile',
    '1st-level evocation',
    'Casting Time: 1 action',
    'Range: 120 feet',
    'Components: V, S',
    'Duration: Instantaneous',
    'You create three glowing darts of magical force.',
    'At Higher Levels. When you cast this spell using a spell slot of 2nd level or higher, the spell creates one more dart for each slot level above 1st.',
    'MAGIC_MISSILE_FINAL_LINE_THAT_MUST_NOT_BE_DROPPED.',
  ],
};

// Closing chapter so the spell-descriptions anchor has an end heading to find,
// and the source slice for the creature parser. Carries one full Goblin stat
// block so runImporter emits a creature record, then the "Nonplayer Characters"
// heading that bounds the Monsters section (monsters anchor requireEndHeading
// is true), so the chapters that follow in the fixture are excluded from the
// monsters slice.
const MONSTERS_PAGE: FixturePage = {
  lines: [
    'Monsters',
    'Goblin',
    'Small humanoid (goblinoid), neutral evil',
    'Armor Class 15 (leather armor, shield)',
    'Hit Points 7 (2d6)',
    'Speed 30 ft.',
    'STR DEX CON INT WIS CHA',
    '8 (−1) 14 (+2) 10 (+0) 10 (+0) 8 (−1) 8 (−1)',
    'Senses darkvision 60 ft., passive Perception 9',
    'Languages Common, Goblin',
    'Challenge 1/4 (50 XP)',
    'Nonplayer Characters',
  ],
};

// Monsters fixture without the end heading that bounds the section. With
// requireEndHeading: true on the monsters anchor, the importer must fail closed
// rather than slice to EOF and feed trailing content to the creature parser.
const MONSTERS_PAGE_MISSING_END: FixturePage = {
  lines: [
    'Monsters',
    'Goblin',
    'Small humanoid (goblinoid), neutral evil',
    'Armor Class 15 (leather armor, shield)',
    'Hit Points 7 (2d6)',
    'Speed 30 ft.',
    'STR DEX CON INT WIS CHA',
    '8 (−1) 14 (+2) 10 (+0) 10 (+0) 8 (−1) 8 (−1)',
    'Challenge 1/4 (50 XP)',
  ],
};

// Monsters fixture whose section is found and properly bounded, but contains
// no parseable stat block. Exercises the empty-result coverage guard.
const MONSTERS_PAGE_NO_CREATURES: FixturePage = {
  lines: [
    'Monsters',
    'This chapter describes monsters, but the stat blocks did not extract.',
    'Nonplayer Characters',
  ],
};

const TREASURE_TABLES_PAGE: FixturePage = {
  lines: [
    'Treasure',
    'Individual Treasure: Challenge 0-4',
    'd100',
    'CP',
    'SP',
    'EP',
    'GP',
    'PP',
    '01-30',
    '31-60',
    '61-70',
    '5d6 (17)',
    '-',
    '-',
    '-',
    '4d6 (14)',
    '-',
    '-',
    '-',
    '3d6 (10)',
    '-',
    '-',
    '-',
    '-',
    '-',
    '-',
    '',
    'Treasure Hoard: Challenge 0-4',
    'd100',
    'CP',
    'SP',
    'GP',
    'Gems or Art Objects',
    'Magic Items',
    '01-06',
    '07-16',
    '17-26',
    '6d6 x 100 (2,100)',
    '6d6 x 100 (2,100)',
    '6d6 x 100 (2,100)',
    '3d6 x 100 (1,050)',
    '3d6 x 100 (1,050)',
    '3d6 x 100 (1,050)',
    '2d6 x 10 (70)',
    '2d6 x 10 (70)',
    '2d6 x 10 (70)',
    '-',
    '2d6 (7) 10 gp gems',
    '2d4 (5) 25 gp art objects',
    '-',
    '-',
    'Table A',
  ],
};

const TREASURE_TABLES_PAGE_MISSING_END: FixturePage = {
  lines: [
    'Treasure',
    'Individual Treasure: Challenge 0-4',
    'd100',
    'CP',
    '01-30',
    '5d6 (17)',
  ],
};

const MAGIC_ITEMS_PAGE: FixturePage = {
  lines: [
    'Magic Items',
    'Using Magic Items',
    'Magic items are gleaned from the hoards of conquered monsters.',
  ],
};

const COMBAT_ACTIONS_PAGE: FixturePage = {
  lines: [
    'Actions in Combat',
    'Attack',
    'The most common action to take in combat is the Attack action.',
    '',
    'Cast a Spell',
    'Spellcasters can use their action to cast a spell with a casting time of 1 action.',
    '',
    'Dash',
    'When you take the Dash action, you gain extra movement for the current turn.',
    '',
    'Disengage',
    "If you take the Disengage action, your movement doesn't provoke opportunity attacks.",
    '',
    'Dodge',
    'When you take the Dodge action, you focus entirely on avoiding attacks.',
    '',
    'Help',
    'You can lend your aid to another creature in the completion of a task.',
    '',
    'Hide',
    'You make a Dexterity (Stealth) check in an attempt to hide.',
    '',
    'Ready',
    'First, you decide what perceivable circumstance will trigger your reaction.',
    '',
    'Search',
    'You devote your attention to finding something.',
    '',
    'Use an Object',
    'You normally interact with an object while doing something else.',
  ],
};

const MAKING_AN_ATTACK_PAGE: FixturePage = {
  lines: [
    'Making an Attack',
    'Whether you are striking with a melee weapon, firing a weapon at range,',
    'or making an attack roll as part of a spell, an attack has a simple structure.',
  ],
};

const COMBAT_ACTIONS_PAGE_MISSING_END: FixturePage = {
  lines: [
    'Actions in Combat',
    'Attack',
    'The most common action to take in combat is the Attack action.',
    '',
    'Cast a Spell',
    'Spellcasters can use their action to cast a spell with a casting time of 1 action.',
    '',
    'Use an Object',
    'You normally interact with an object while doing something else.',
    '',
    'Later combat prose without an ending chapter heading',
    'This line should not be consumed by the action parser to EOF.',
  ],
};

// Hazards fixture: mirrors the SRD "Dungeon Hazards" section (Brown Mold only
// here; 4 hazards in the real SRD). The heading "Dungeon Hazards" matches the
// hazards startHeading anchor; "Traps" below acts as the end heading.
const HAZARDS_PAGE: FixturePage = {
  lines: [
    'Dungeon Hazards',
    'Brown Mold',
    'Brown mold feeds on warmth, draining heat from everything nearby.',
    '',
    'Traps',
    'A trap can be either mechanical or magical in nature.',
  ],
};

// Hazards fixture without the end heading. This reproduces the bug where the
// importer would otherwise run hazards to EOF and absorb later text.
const HAZARDS_PAGE_MISSING_END: FixturePage = {
  lines: [
    'Dungeon Hazards',
    'Brown Mold',
    'Brown mold feeds on warmth, draining heat from everything nearby.',
    '',
    'Later DM tools prose',
    'This text should not be included in the hazards section.',
  ],
};

// Feats fixture: mirrors the SRD "Feats" section (only Grappler in SRD 5.1).
const FEATS_PAGE: FixturePage = {
  lines: [
    'Feats',
    'Grappler',
    'Prerequisite: Strength 13 or higher',
    "You've developed the skills necessary to hold your own in close-quarters grappling.",
    '• You have advantage on attack rolls against a creature you are grappling.',
  ],
};

// Equipment fixture: mirrors the SRD "Equipment" chapter with rows from each of
// the three parsed tables (armor, weapons, adventuring gear). The Sling row is
// the canonical em-dash-weight case (its Weight column is a dash, not "N lb.")
// — kept here so the property-preservation fix is protected end-to-end through
// the full extract → parse → emit pipeline. The trailing "Mounts and Vehicles"
// line is the chapter subsection that closes the gear table and matches the
// equipment endHeading anchor.
const EQUIPMENT_PAGE: FixturePage = {
  lines: [
    'Equipment',
    'Armor',
    'Armor Cost Armor Class (AC) Strength Stealth Weight',
    'Light Armor',
    'Leather 10 gp 11 + Dex modifier 10 lb.',
    'Weapons',
    'Name Cost Damage Weight Properties',
    'Simple Melee Weapons',
    'Dagger 2 gp 1d4 piercing 1 lb. Finesse, light, thrown (range 20/60)',
    'Simple Ranged Weapons',
    'Sling 1 sp 1d4 bludgeoning — Ammunition (range 30/120)',
    'Adventuring Gear',
    'Item Cost Weight',
    'Rope, hempen (50 feet) 1 gp 10 lb.',
    'Mounts and Vehicles',
  ],
};

// Equipment fixture without the chapter subsection that ends the section. With
// requireEndHeading: true on the equipment anchor, the importer must fail
// closed rather than slice to EOF.
const EQUIPMENT_PAGE_MISSING_END: FixturePage = {
  lines: [
    'Equipment',
    'Weapons',
    'Name Cost Damage Weight Properties',
    'Simple Melee Weapons',
    'Dagger 2 gp 1d4 piercing 1 lb. Finesse, light, thrown (range 20/60)',
  ],
};

// Core-rules fixture: mirrors "Using Ability Scores" through combat/adventuring
// subsections where rule-text entries like "Cover" and "Resting" appear.
// The core-rules section ends at "Spell Lists" (handled by section anchors).
const CORE_RULES_PAGE_ONE: FixturePage = {
  lines: [
    'Using Ability Scores',
    'Cover',
    'Walls, trees, creatures, and other obstacles can provide cover during combat.',
    'A target with half cover has a +2 bonus to AC and Dexterity saving throws.',
  ],
};

const CORE_RULES_PAGE_TWO: FixturePage = {
  lines: [
    'Resting',
    'Adventurers can take short rests and long rests to recover from wounds.',
    'A short rest is at least 1 hour long, and a long rest is at least 8 hours.',
  ],
};

const CORE_RULES_TABLES_PAGE: FixturePage = {
  lines: [
    'Difficulty Classes',
    'Task Difficulty',
    'DC',
    'Very easy 5',
    'Easy 10',
    'Medium 15',
    'Hard 20',
    'Very hard 25',
    'Nearly impossible 30',
    '',
    'XP Thresholds by Character Level',
    'Character Level',
    'Easy',
    'Medium',
    'Hard',
    'Deadly',
    '1st 25 50 75 100',
    '2nd 50 100 150 200',
    '3rd 75 150 225 400',
    '4th 125 250 375 500',
  ],
};

// Conditions fixture: mirrors "Appendix A: Conditions" with two representative
// conditions (Blinded for a flat-effect case, Prone for a single-effect case).
const CONDITIONS_PAGE: FixturePage = {
  lines: [
    'Appendix A: Conditions',
    'Blinded',
    "• A blinded creature can't see and automatically fails any ability check that requires sight.",
    "• Attack rolls against the creature have advantage, and the creature's attack rolls have disadvantage.",
    '',
    'Prone',
    '• A prone creature has disadvantage on attack rolls.',
    '• An attack roll against the creature has advantage if the attacker is within 5 feet.',
  ],
};

// Races fixture: mirrors the SRD "Races" chapter. Dwarf (with the Hill Dwarf
// subrace) exercises the parent+subrace flattening; Human exercises a race with
// no subraces. "Classes" below acts as the races section's end heading.
const RACES_PAGE: FixturePage = {
  lines: [
    'Races',
    'Dwarf',
    'Bold and hardy, dwarves are known as skilled warriors, miners, and workers of stone.',
    'Dwarf Traits',
    'Your dwarf character has an assortment of inborn abilities.',
    'Ability Score Increase. Your Constitution score increases by 2.',
    'Age. Dwarves mature at the same rate as humans but live about 350 years.',
    'Alignment. Most dwarves are lawful.',
    'Size. Dwarves stand between 4 and 5 feet tall. Your size is Medium.',
    'Speed. Your base walking speed is 25 feet.',
    'Darkvision. You have superior vision in dark and dim conditions.',
    'Languages. You can speak, read, and write Common and Dwarvish.',
    'Subrace. Two main subraces of dwarves populate the worlds of D&D.',
    'Hill Dwarf',
    'As a hill dwarf, you have keen senses and remarkable resilience.',
    'Ability Score Increase. Your Wisdom score increases by 1.',
    'Dwarven Toughness. Your hit point maximum increases by 1.',
    'Human',
    'Humans are the youngest of the common races.',
    'Human Traits',
    'Your human character has these traits.',
    'Ability Score Increase. Your ability scores each increase by 1.',
    'Age. Humans reach adulthood in their late teens.',
    'Size. Humans vary widely in height and build. Your size is Medium.',
    'Speed. Your base walking speed is 30 feet.',
    'Languages. You can speak, read, and write Common and one extra language.',
  ],
};

// End heading for the races section AND the start of the Classes chapter. Now
// carries one full base-class block (Fighter) plus its subclass (Champion) so
// runImporter emits both a class and a subclass record; the chapter is bounded
// below by "Using Ability Scores" (the classes-anchor end heading, supplied by
// CORE_RULES_PAGE_ONE). Class-feature and subclass text is reproduced from the
// SRD 5.1 (CC-BY-4.0) as parser input.
const CLASSES_PAGE: FixturePage = {
  lines: [
    'Classes',
    'Fighter',
    'A master of martial combat, skilled with a variety of weapons and armor.',
    'Class Features',
    'As a fighter, you gain the following class features.',
    'Hit Points',
    'Hit Dice: 1d10 per fighter level',
    'Hit Points at 1st Level: 10 + your Constitution modifier',
    'Proficiencies',
    'Armor: All armor, shields',
    'Weapons: Simple weapons, martial weapons',
    'Tools: None',
    'Saving Throws: Strength, Constitution',
    'Skills: Choose two skills from Acrobatics, Athletics, History, Insight',
    'Martial Archetypes',
    'Different fighters choose different approaches to perfecting their martial prowess.',
    'Champion',
    'The archetypal Champion focuses on the development of raw physical power honed to deadly perfection.',
    'Improved Critical',
    'Beginning when you choose this archetype at 3rd level, your weapon attacks score a critical hit on a roll of 19 or 20.',
  ],
};

// Classes fixture whose section is found and properly bounded, but contains no
// parseable class block (no "Hit Dice: 1dN per <class> level" signature).
// Exercises the empty-result class-coverage guard.
const CLASSES_PAGE_NO_CLASSES: FixturePage = {
  lines: [
    'Classes',
    'This chapter introduces the classes, but no class block extracted.',
  ],
};

// Classes fixture that yields a base class (Fighter) but NO subclass heading.
// Exercises the empty-result subclass-coverage guard: the class parse succeeds
// (so validateClassCoverage passes), but the subclass parse is empty and must
// fail closed rather than emit a pack that silently omits `subclass`.
const CLASSES_PAGE_NO_SUBCLASS: FixturePage = {
  lines: [
    'Classes',
    'Fighter',
    'A master of martial combat, skilled with a variety of weapons and armor.',
    'Class Features',
    'Hit Dice: 1d10 per fighter level',
    'Armor: All armor, shields',
    'Weapons: Simple weapons, martial weapons',
    'Saving Throws: Strength, Constitution',
  ],
};

describe('runImporter — end-to-end against a fixture PDF', () => {
  it('extracts implemented SRD kinds and writes a pack that loads through loadRulesPackFromDirectory', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      RACES_PAGE,
      CLASSES_PAGE,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      CORE_RULES_TABLES_PAGE,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    const result = await runImporter({ pdfPath, outDir });
    expect(result.counts.spells).toBe(2);
    expect(result.counts.creatures).toBe(1);
    expect(result.counts.classes).toBe(1);
    expect(result.counts.subclasses).toBe(1);
    expect(result.counts.features).toBe(1);
    expect(result.counts.conditions).toBe(2);
    expect(result.counts.feats).toBe(1);
    expect(result.counts.hazards).toBe(1);
    expect(result.counts.actions).toBe(10);
    expect(result.counts.rules).toBe(2);
    expect(result.counts.tables).toBe(4);
    expect(result.counts.equipment).toBe(4);
    expect(result.counts.ancestries).toBe(3);
    expect(result.sourceHash).toMatch(/^[0-9a-f]{64}$/);

    const pack = loadRulesPackFromDirectory(outDir);
    expect(pack.records).toHaveLength(33);
    const keys = pack.records.map((r) => r.key).sort();
    expect(keys).toContain('class:fighter');
    expect(keys).toContain('subclass:champion');
    expect(keys).toContain('feature:champion:improved-critical');
    expect(keys).toContain('action:attack');
    expect(keys).toContain('action:cast-a-spell');
    expect(keys).toContain('action:dash');
    expect(keys).toContain('action:disengage');
    expect(keys).toContain('action:dodge');
    expect(keys).toContain('action:help');
    expect(keys).toContain('action:hide');
    expect(keys).toContain('action:ready');
    expect(keys).toContain('action:search');
    expect(keys).toContain('action:use-an-object');
    expect(keys).toContain('spell:acid-splash');
    expect(keys).toContain('spell:magic-missile');
    expect(keys).toContain('creature:goblin');
    expect(keys).toContain('condition:blinded');
    expect(keys).toContain('condition:prone');
    expect(keys).toContain('feat:grappler');
    expect(keys).toContain('rule:cover');
    expect(keys).toContain('rule:resting');
    expect(keys).toContain('table:difficulty-classes');
    expect(keys).toContain('table:xp-thresholds-by-character-level');
    expect(keys).toContain('ancestry:dwarf');
    expect(keys).toContain('ancestry:hill-dwarf');
    expect(keys).toContain('ancestry:human');
    // Assert the feat set is exactly Grappler — no bogus chapter headings
    // promoted as feat names by the heuristic.
    const featKeys = keys.filter((k) => k.startsWith('feat:'));
    expect(featKeys).toEqual(['feat:grappler']);
    // Assert the hazard set is exactly Brown Mold.
    const hazardKeys = keys.filter((k) => k.startsWith('hazard:'));
    expect(hazardKeys).toEqual(['hazard:brown-mold']);
    const actionKeys = keys.filter((k) => k.startsWith('action:'));
    expect(actionKeys).toEqual([
      'action:attack',
      'action:cast-a-spell',
      'action:dash',
      'action:disengage',
      'action:dodge',
      'action:help',
      'action:hide',
      'action:ready',
      'action:search',
      'action:use-an-object',
    ]);
    const ruleKeys = keys.filter((k) => k.startsWith('rule:'));
    expect(ruleKeys).toEqual(['rule:cover', 'rule:resting']);
    const tableKeys = keys.filter((k) => k.startsWith('table:'));
    expect(tableKeys).toEqual([
      'table:difficulty-classes',
      'table:individual-treasure-challenge-0-4',
      'table:treasure-hoard-challenge-0-4',
      'table:xp-thresholds-by-character-level',
    ]);
    const equipmentKeys = keys.filter((k) => k.startsWith('equipment:'));
    expect(equipmentKeys).toEqual([
      'equipment:dagger',
      'equipment:leather',
      'equipment:rope-hempen-50-feet',
      'equipment:sling',
    ]);

    // The generated manifest must advertise equipment as an included kind.
    expect(pack.meta.description).toMatch(
      /Included record kinds:[^.]*equipment/,
    );
    const ancestryKeys = keys.filter((k) => k.startsWith('ancestry:'));
    expect(ancestryKeys).toEqual([
      'ancestry:dwarf',
      'ancestry:hill-dwarf',
      'ancestry:human',
    ]);

    // Parent race: preserves the source 'race' term and references its subrace.
    const dwarf = pack.records.find((r) => r.key === 'ancestry:dwarf');
    expect(dwarf?.kind).toBe('ancestry');
    const dwarfData = dwarf?.data as Record<string, unknown>;
    expect(dwarfData.source).toBe('race');
    expect(dwarfData.size).toBe('Medium');
    expect(dwarfData.speed).toBe(25);
    expect(dwarfData.subraces).toEqual(['ancestry:hill-dwarf']);
    expect(dwarfData.subraceOf).toBeUndefined();

    // Subrace: flattened/self-contained, points back at the parent, inherits the
    // parent's racial traits, and carries its own.
    const hillDwarf = pack.records.find((r) => r.key === 'ancestry:hill-dwarf');
    const hillData = hillDwarf?.data as Record<string, unknown>;
    expect(hillData.source).toBe('race');
    expect(hillData.subraceOf).toBe('ancestry:dwarf');
    expect(hillData.subraces).toBeUndefined();
    const hillTraitNames = (
      hillData.traits as ReadonlyArray<{ name: string }>
    ).map((t) => t.name);
    expect(hillTraitNames).toContain('Darkvision');
    expect(hillTraitNames).toContain('Dwarven Toughness');

    // Race without subraces.
    const human = pack.records.find((r) => r.key === 'ancestry:human');
    const humanData = human?.data as Record<string, unknown>;
    expect(humanData.subraces).toBeUndefined();
    expect(humanData.subraceOf).toBeUndefined();
    expect(humanData.speed).toBe(30);

    const acid = pack.records.find((r) => r.key === 'spell:acid-splash');
    expect(acid?.name).toBe('Acid Splash');
    const acidData = acid?.data as Record<string, unknown>;
    expect(acidData.level).toBe(0);
    expect(acidData.school).toBe('conjuration');
    expect(acidData.classes).toEqual(['Sorcerer', 'Wizard']);

    const hazardRecords = pack.records.filter((r) => r.kind === 'hazard');
    expect(hazardRecords.map((r) => r.key)).toEqual(['hazard:brown-mold']);
    expect(hazardRecords.map((r) => r.name)).toEqual(['Brown Mold']);
    const brown = hazardRecords[0];
    const brownData = brown?.data as Record<string, unknown>;
    expect(brownData.description).not.toMatch(
      /A trap can be either mechanical or magical in nature\./,
    );

    const mm = pack.records.find((r) => r.key === 'spell:magic-missile');
    const mmData = mm?.data as Record<string, unknown>;
    expect(mmData.level).toBe(1);
    expect(mmData.higherLevels).toMatch(/^When you cast this spell/);

    const blinded = pack.records.find((r) => r.key === 'condition:blinded');
    expect(blinded?.name).toBe('Blinded');
    const blindedData = blinded?.data as Record<string, unknown>;
    expect(typeof blindedData.description).toBe('string');
    expect((blindedData.description as string).length).toBeGreaterThan(0);

    const grappler = pack.records.find((r) => r.key === 'feat:grappler');
    expect(grappler?.name).toBe('Grappler');
    const grapplerData = grappler?.data as Record<string, unknown>;
    expect(grapplerData.prerequisites).toBe('Strength 13 or higher');
    expect(typeof grapplerData.description).toBe('string');
    expect((grapplerData.description as string).length).toBeGreaterThan(0);

    // The generated manifest must advertise creature as an included kind.
    expect(pack.meta.description).toMatch(
      /Included record kinds:[^.]*creature/,
    );

    const goblin = pack.records.find((r) => r.key === 'creature:goblin');
    expect(goblin?.kind).toBe('creature');
    expect(goblin?.name).toBe('Goblin');
    const goblinData = goblin?.data as Record<string, unknown>;
    expect(goblinData.size).toBe('Small');
    expect(goblinData.type).toBe('humanoid');
    expect(goblinData.alignment).toBe('neutral evil');
    expect(goblinData.armorClass).toBe(15);
    expect(goblinData.hitPoints).toBe(7);
    expect(goblinData.speed).toEqual({ walk: 30 });
    expect(goblinData.challengeRating).toBe('1/4');
    expect(goblinData.abilityScores).toEqual({
      strength: 8,
      dexterity: 14,
      constitution: 10,
      intelligence: 10,
      wisdom: 8,
      charisma: 8,
    });

    // The generated manifest must advertise class as an included kind.
    expect(pack.meta.description).toMatch(/Included record kinds:[^.]*class/);

    const fighter = pack.records.find((r) => r.key === 'class:fighter');
    expect(fighter?.kind).toBe('class');
    expect(fighter?.name).toBe('Fighter');
    const fighterData = fighter?.data as Record<string, unknown>;
    expect(fighterData.hitDie).toBe(10);
    expect(fighterData.armorProficiencies).toEqual(['All armor', 'shields']);
    expect(fighterData.weaponProficiencies).toEqual([
      'Simple weapons',
      'martial weapons',
    ]);
    expect(fighterData.savingThrowProficiencies).toEqual([
      'Strength',
      'Constitution',
    ]);
    // SRD Class Features block carries no primary-ability line (ADR 0007).
    expect(fighterData.primaryAbilities).toEqual([]);

    // The generated manifest must advertise subclass as an included kind.
    expect(pack.meta.description).toMatch(
      /Included record kinds:[^.]*subclass/,
    );

    const champion = pack.records.find((r) => r.key === 'subclass:champion');
    expect(champion?.kind).toBe('subclass');
    expect(champion?.name).toBe('Champion');
    const championData = champion?.data as Record<string, unknown>;
    // Parent linkage is data-side and keyed to the class record (ADR 0009).
    expect(championData.parentClass).toBe('class:fighter');
    expect(champion?.overrides).toBeUndefined();
    expect(typeof championData.description).toBe('string');
    expect(championData.description).toMatch(/archetypal Champion/);
    // Base-class proficiency text must not bleed into the subclass body.
    expect(championData.description).not.toMatch(/Hit Dice/);

    // The generated manifest must advertise feature as an included kind.
    expect(pack.meta.description).toMatch(/Included record kinds:[^.]*feature/);

    const improvedCritical = pack.records.find(
      (r) => r.key === 'feature:champion:improved-critical',
    );
    expect(improvedCritical?.kind).toBe('feature');
    expect(improvedCritical?.name).toBe('Improved Critical');
    const improvedCriticalData = improvedCritical?.data as Record<
      string,
      unknown
    >;
    expect(improvedCriticalData.source).toBe('subclass:champion');
    expect(improvedCriticalData.level).toBe(3);
    expect(improvedCriticalData.description).toMatch(/critical hit/);

    const dagger = pack.records.find((r) => r.key === 'equipment:dagger');
    expect(dagger?.name).toBe('Dagger');
    const daggerData = dagger?.data as Record<string, unknown>;
    expect(daggerData.category).toBe('weapon');
    expect(daggerData.damageDie).toBe('1d4');
    expect(daggerData.damageType).toBe('piercing');
    expect(daggerData.properties).toEqual([
      'Finesse',
      'light',
      'thrown (range 20/60)',
    ]);

    const leather = pack.records.find((r) => r.key === 'equipment:leather');
    const leatherData = leather?.data as Record<string, unknown>;
    expect(leatherData.category).toBe('armor');
    expect(leatherData.ac).toBe('11 + Dex modifier');
    expect(leatherData.armorType).toBe('light');
    expect(leatherData.stealthDisadvantage).toBe(false);

    // Canonical em-dash-weight weapon: its properties must survive the full
    // pipeline (regression guard for the dropped-properties bug).
    const sling = pack.records.find((r) => r.key === 'equipment:sling');
    const slingData = sling?.data as Record<string, unknown>;
    expect(slingData.category).toBe('weapon');
    expect(slingData.damageDie).toBe('1d4');
    expect(slingData.damageType).toBe('bludgeoning');
    expect(slingData.properties).toEqual(['Ammunition (range 30/120)']);
    expect(slingData.weight).toBeUndefined();

    const cover = pack.records.find((r) => r.key === 'rule:cover');
    expect(cover?.name).toBe('Cover');
    const coverData = cover?.data as Record<string, unknown>;
    expect(typeof coverData.text).toBe('string');
    expect((coverData.text as string).length).toBeGreaterThan(0);
    expect(coverData.text).toMatch(/provide cover during combat/i);

    const difficultyTable = pack.records.find(
      (r) => r.key === 'table:difficulty-classes',
    );
    expect((difficultyTable?.data as Record<string, unknown>).columns).toEqual([
      'Task Difficulty',
      'DC',
    ]);
    expect((difficultyTable?.data as Record<string, unknown>).rows).toEqual([
      ['Very easy', 5],
      ['Easy', 10],
      ['Medium', 15],
      ['Hard', 20],
      ['Very hard', 25],
      ['Nearly impossible', 30],
    ]);

    const xpThresholdTable = pack.records.find(
      (r) => r.key === 'table:xp-thresholds-by-character-level',
    );
    expect((xpThresholdTable?.data as Record<string, unknown>).columns).toEqual(
      ['Character Level', 'Easy', 'Medium', 'Hard', 'Deadly'],
    );
    expect((xpThresholdTable?.data as Record<string, unknown>).rows).toEqual([
      ['1st', 25, 50, 75, 100],
      ['2nd', 50, 100, 150, 200],
      ['3rd', 75, 150, 225, 400],
      ['4th', 125, 250, 375, 500],
    ]);

    const individualTreasureTable = pack.records.find(
      (r) => r.key === 'table:individual-treasure-challenge-0-4',
    );
    expect(
      (individualTreasureTable?.data as Record<string, unknown>).columns,
    ).toEqual(['d100', 'CP', 'SP', 'EP', 'GP', 'PP']);
    expect(
      (individualTreasureTable?.data as Record<string, unknown>).rows,
    ).toEqual([
      ['01-30', '5d6 (17)', null, null, null, null],
      ['31-60', null, '4d6 (14)', null, null, null],
      ['61-70', null, null, '3d6 (10)', null, null],
    ]);

    const treasureHoardTable = pack.records.find(
      (r) => r.key === 'table:treasure-hoard-challenge-0-4',
    );
    expect(
      (treasureHoardTable?.data as Record<string, unknown>).columns,
    ).toEqual(['d100', 'CP', 'SP', 'GP', 'Gems or Art Objects', 'Magic Items']);
    expect((treasureHoardTable?.data as Record<string, unknown>).rows).toEqual([
      [
        '01-06',
        '6d6 x 100 (2,100)',
        '3d6 x 100 (1,050)',
        '2d6 x 10 (70)',
        null,
        null,
      ],
      [
        '07-16',
        '6d6 x 100 (2,100)',
        '3d6 x 100 (1,050)',
        '2d6 x 10 (70)',
        '2d6 (7) 10 gp gems',
        null,
      ],
      [
        '17-26',
        '6d6 x 100 (2,100)',
        '3d6 x 100 (1,050)',
        '2d6 x 10 (70)',
        '2d4 (5) 25 gp art objects',
        'Table A',
      ],
    ]);
  });

  it('produces a byte-identical pack across two runs over the same PDF', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outA = join(workDir, 'a');
    const outB = join(workDir, 'b');
    await writeFixturePdf(pdfPath, [
      RACES_PAGE,
      CLASSES_PAGE,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    await runImporter({ pdfPath, outDir: outA });
    await runImporter({ pdfPath, outDir: outB });

    expect(readFileSync(join(outA, 'manifest.json'), 'utf8')).toBe(
      readFileSync(join(outB, 'manifest.json'), 'utf8'),
    );
    expect(readFileSync(join(outA, 'records.json'), 'utf8')).toBe(
      readFileSync(join(outB, 'records.json'), 'utf8'),
    );
  });

  it('preserves the final line of the final spell (body-slicing regression)', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      RACES_PAGE,
      CLASSES_PAGE,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    await runImporter({ pdfPath, outDir });
    const pack = loadRulesPackFromDirectory(outDir);
    const mm = pack.records.find((r) => r.key === 'spell:magic-missile');
    const mmData = mm?.data as Record<string, unknown>;
    const haystack = `${mmData.description ?? ''}\n${mmData.higherLevels ?? ''}`;
    expect(haystack).toMatch(
      /MAGIC_MISSILE_FINAL_LINE_THAT_MUST_NOT_BE_DROPPED/,
    );
  });

  it("does not bleed class-list or monster text into the final spell's body", async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      RACES_PAGE,
      CLASSES_PAGE,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    await runImporter({ pdfPath, outDir });
    const pack = loadRulesPackFromDirectory(outDir);

    for (const record of pack.records) {
      const data = record.data as Record<string, unknown>;
      const haystack = [
        data.description,
        data.higherLevels,
        data.componentMaterials,
      ]
        .filter((v): v is string => typeof v === 'string')
        .join('\n');
      // Class-list section headers / content must not appear inside any
      // spell's textual fields.
      expect(haystack).not.toMatch(/Wizard Spells/);
      expect(haystack).not.toMatch(/Sorcerer Spells/);
      expect(haystack).not.toMatch(/Cantrips \(0 Level\)/);
      expect(haystack).not.toMatch(/^Acid Splash$/m);
      // Following-chapter (monsters) content must not appear either.
      expect(haystack).not.toMatch(/Monsters/);
      expect(haystack).not.toMatch(/Goblin/);
      expect(haystack).not.toMatch(/Small humanoid/);
    }
  });

  it('fails closed when the spell-descriptions anchor cannot be found', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // Fixture with neither a "Spells" nor a "Spell Lists" heading — the
    // importer must refuse to run rather than silently feed the whole PDF
    // to the parser.
    const orphan: FixturePage = {
      lines: ['Acid Splash', 'Conjuration cantrip'],
    };
    await writeFixturePdf(pdfPath, [orphan]);
    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      /heading not found/,
    );
  });

  it('fails closed when the conditions heading is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // Spell Lists, Spells, Monsters, and Feats are present so those pipelines
    // succeed, but there is no conditions chapter. The importer must refuse
    // to run rather than silently emit a pack without conditions.
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      FEATS_PAGE,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
    ]);
    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      /heading not found/,
    );
  });

  it('fails closed when the spell-descriptions end heading (e.g. "Monsters") is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // Spell Lists and Spells start headings are present (so spellLists slice
    // succeeds and spellDescriptions start is found), but the chapter after
    // Spells is missing — pre-fix this would have silently sliced the spell
    // descriptions to EOF and let any later content bleed in. With
    // requireEndHeading: true, the importer must refuse to run.
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
    ]);
    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      /end heading not found/,
    );
  });

  it('fails closed when the feats end heading is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // All sections except the feats end heading are present. FEATS_PAGE is
    // placed last so no subsequent heading matches the feats endHeading pattern.
    // With requireEndHeading: true on the feats anchor, the importer must
    // throw SectionNotFoundError rather than silently slice to EOF (which would
    // let later chapter headings be promoted as bogus feat records).
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      CONDITIONS_PAGE,
      FEATS_PAGE,
    ]);
    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      /end heading not found/,
    );
  });

  it('fails closed when the hazards end heading is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE_MISSING_END,
      FEATS_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      SectionNotFoundError,
    );
  });

  it('fails closed when the treasure-table end heading is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE_MISSING_END,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      SectionNotFoundError,
    );
  });

  it('fails closed when the equipment end heading is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE_MISSING_END,
      CONDITIONS_PAGE,
    ]);

    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      SectionNotFoundError,
    );
  });

  it('fails closed when the combat-actions end heading is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      COMBAT_ACTIONS_PAGE_MISSING_END,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      SectionNotFoundError,
    );
  });

  it('fails closed when the races section is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // Every other section is present so all earlier slices succeed; only the
    // races chapter is absent. With requireEndHeading on the races anchor the
    // importer must refuse to run rather than emit a pack without ancestries.
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      CORE_RULES_TABLES_PAGE,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      SectionNotFoundError,
    );
  });

  it('fails closed when the monsters end heading is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // Conditions is placed before the (end-less) Monsters section so its
    // "Appendix A: Conditions" heading can't double as the monsters end
    // boundary; nothing after the Monsters heading matches the monsters end
    // anchor, so with requireEndHeading: true the slice must fail rather than
    // run to EOF and feed trailing content to the creature parser.
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      CONDITIONS_PAGE,
      MONSTERS_PAGE_MISSING_END,
    ]);

    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      SectionNotFoundError,
    );
  });

  it('fails closed when the Monsters section yields no creatures', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // The Monsters section is found and properly bounded, but no stat block
    // parses out of it. The coverage guard must reject the empty result and
    // write nothing rather than emit a creature-less pack.
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE_NO_CREATURES,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      CreatureCoverageError,
    );
    // Nothing should have been written.
    expect(() => readFileSync(join(outDir, 'records.json'), 'utf8')).toThrow();
  });

  it('fails closed when fewer creatures than minCreatureCount are parsed', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // The fixture's Monsters section yields a single creature (Goblin); a
    // minCreatureCount of 2 must trip the coverage floor with a deterministic
    // message naming the observed and expected counts.
    await writeFixturePdf(pdfPath, [
      RACES_PAGE,
      CLASSES_PAGE,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      CORE_RULES_TABLES_PAGE,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(
      runImporter({ pdfPath, outDir, minCreatureCount: 2 }),
    ).rejects.toThrow(/parsed 1 creature stat block\(s\), expected at least 2/);
  });

  it('fails closed when the Classes section yields no classes', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // Every section is present and valid except the Classes chapter, which is
    // found and bounded (Races → Classes → Using Ability Scores) but carries no
    // class block. The class-coverage guard must reject the empty result and
    // write nothing rather than emit a class-less pack.
    await writeFixturePdf(pdfPath, [
      RACES_PAGE,
      CLASSES_PAGE_NO_CLASSES,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      CORE_RULES_TABLES_PAGE,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      ClassCoverageError,
    );
    // Nothing should have been written.
    expect(() => readFileSync(join(outDir, 'records.json'), 'utf8')).toThrow();
  });

  it('fails closed when the Classes section yields classes but no subclasses', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // The Classes chapter parses a base class (Fighter) but carries no subclass
    // heading. Subclass is an implemented kind, so the subclass-coverage guard
    // must reject the empty result and write nothing rather than emit a pack
    // that silently omits `subclass`.
    await writeFixturePdf(pdfPath, [
      RACES_PAGE,
      CLASSES_PAGE_NO_SUBCLASS,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      CORE_RULES_TABLES_PAGE,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      SubclassCoverageError,
    );
    // Nothing should have been written.
    expect(() => readFileSync(join(outDir, 'records.json'), 'utf8')).toThrow();
  });

  it('fails closed when fewer subclasses than minSubclassCount are parsed', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // The fixture's Classes section yields a single subclass (Champion); a
    // minSubclassCount of 2 must trip the coverage floor with a deterministic
    // message naming the observed and expected counts.
    await writeFixturePdf(pdfPath, [
      RACES_PAGE,
      CLASSES_PAGE,
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      CORE_RULES_TABLES_PAGE,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      TREASURE_TABLES_PAGE,
      MAGIC_ITEMS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      EQUIPMENT_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(
      runImporter({ pdfPath, outDir, minSubclassCount: 2 }),
    ).rejects.toThrow(/parsed 1 subclass\(es\), expected at least 2/);
  });
});
