/**
 * Programmatic API for the D&D 5e SRD 5.1 importer.
 *
 * `runImporter` is the single entry point: reads the vendored PDF, extracts
 * text, slices the SRD's spell-descriptions and spell-lists sections using
 * deterministic anchor headings (see `sections.ts`), parses spells (and
 * spell-class lists) against those narrowed slices, builds a validated
 * `RulesPack`, and writes `manifest.json` + `records.json` to the requested
 * output directory.
 *
 * Failing-closed design: if the section anchors don't match the input PDF,
 * the importer throws `SectionNotFoundError`. It never silently runs the
 * spell parser over the whole PDF (which would let class-list text and
 * unrelated chapters bleed into the last spell's body). The creature set is
 * additionally guarded by `validateCreatureCoverage`: an empty Monsters parse
 * always throws `CreatureCoverageError`, and the real import is validated
 * against the exact SRD 5.1 creature name set (`EXPECTED_SRD_5_1_CREATURE_NAMES`)
 * so a dropped, renamed, or spuriously-extracted creature trips immediately by
 * name rather than only on gross truncation. The ancestry set is guarded the
 * same way (exact expected-name coverage) so a valid Races slice cannot
 * silently under-extract race/subrace records.
 *
 * Scope today: spells, creatures, base classes, subclasses, features,
 * conditions, feats, hazards, actions, rules, tables, equipment, and ancestries
 * (races + subraces). Subclasses (Champion, Life domain, …) and class /
 * subclass features parse from the same Classes-chapter slice as base classes.
 * Other SRD record kinds are tracked under `loreweaver-0m9.5` child issues;
 * until those parsers ship the importer deliberately omits them so the
 * generated pack does not claim coverage it does not have. See `README.md`
 * next to this file for the breakdown.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildPack, writePackToDirectory } from './emit.js';
import { extractPdfText } from './extract.js';
import { parseActions } from './parseActions.js';
import { parseAncestries } from './parseAncestries.js';
import { parseClasses } from './parseClasses.js';
import { parseConditions } from './parseConditions.js';
import { parseCreatures } from './parseCreatures.js';
import { parseEquipment, parseMountsAndVehicles } from './parseEquipment.js';
import { parseFeats } from './parseFeats.js';
import { parseFeatures } from './parseFeatures.js';
import { parseHazards } from './parseHazards.js';
import { parseMulticlassing } from './parseMulticlassing.js';
import { parseRules } from './parseRules.js';
import { parseSpellClassLists, parseSpells } from './parseSpells.js';
import { parseSubclasses } from './parseSubclasses.js';
import { parseTables } from './parseTables.js';
import {
  type SectionAnchorOptions,
  SectionNotFoundError,
  SRD_5_1_DEFAULT_SECTION_ANCHORS,
  type Srd51SectionAnchors,
  sliceSection,
} from './sections.js';
import type {
  AncestryExtraction,
  ClassPrimaryAbilityIndex,
  CreatureExtraction,
  ImporterRunResult,
} from './types.js';

/**
 * Reviewed creature count for the vendored SRD 5.1 CC PDF: 201 stat blocks
 * in the alphabetic "Monsters" chapter plus 95 in "Appendix MM-A:
 * Miscellaneous Creatures" (animals/beasts/swarms). "Appendix MM-B:
 * Nonplayer Characters" is intentionally out of scope — see the
 * `miscellaneousCreatures` anchor in `sections.ts`. Because the source
 * PDF is vendored and hash-pinned (see `sources/dnd5e-srd-5.1/`), this is
 * a fixed property of the input artifact: any change must be an
 * intentional baseline update with re-review, not slack-headroom.
 *
 * This is the documented count baseline for the vendored artifact. The real
 * import is gated on the stronger exact name set below
 * (`EXPECTED_SRD_5_1_CREATURE_NAMES`), whose length a test cross-checks against
 * this constant so the two cannot drift. It remains a coarse opt-in floor
 * (`minCreatureCount`) for fixture pipelines that exercise a reduced Monsters
 * section without the full name set.
 */
export const MIN_EXPECTED_SRD_5_1_CREATURES = 296;

/**
 * Reviewed, checked-in SRD 5.1 creature name-set baseline (loreweaver-0m9.5.14).
 * The real import validates parsed creature names against this exact set, so
 * `validateCreatureCoverage` fails closed naming any specific missing, renamed,
 * or spuriously-extracted creature, not just gross truncation. Replaces the
 * bare `MIN_EXPECTED_SRD_5_1_CREATURES` count floor for the real import.
 *
 * Provenance — this is a reviewed regression baseline, NOT runtime-derived
 * expected data:
 *   1. A candidate list was *generated* from the vendored SRD 5.1 PDF by
 *      running the importer over it
 *      (`npm run generate:dnd5e-srd-creature-names`). Hand-enumerating 296
 *      Monsters-chapter names is the error-prone task the bead explicitly
 *      warned against, so the candidate is machine-produced, not hand-typed.
 *   2. That candidate was *reviewed against the SRD source* — the alphabetic
 *      "Monsters" chapter (201 stat blocks) plus "Appendix MM-A: Miscellaneous
 *      Creatures" (95 entries); "Appendix MM-B: Nonplayer Characters" is
 *      intentionally out of scope for the `creature` kind.
 *   3. The reviewed list is committed here as a fixed baseline.
 *
 * Its value is forward regression protection: it does not by itself prove the
 * importer captured the SRD completely (the one-time review step did that).
 * Once committed, a parser change that drops, adds, or renames a creature
 * record fails closed against it. A test in `srdGeneratedPack.test.ts` compares
 * the committed pack's creature record names against this baseline so the two
 * cannot drift apart silently; an intentional coverage change re-runs the
 * generator, re-reviews, and updates this constant in the same change.
 */
export const EXPECTED_SRD_5_1_CREATURE_NAMES: readonly string[] = [
  'Aboleth',
  'Adult Black Dragon',
  'Adult Blue Dragon',
  'Adult Brass Dragon',
  'Adult Bronze Dragon',
  'Adult Copper Dragon',
  'Adult Gold Dragon',
  'Adult Green Dragon',
  'Adult Red Dragon',
  'Adult Silver Dragon',
  'Adult White Dragon',
  'Air Elemental',
  'Ancient Black Dragon',
  'Ancient Blue Dragon',
  'Ancient Brass Dragon',
  'Ancient Bronze Dragon',
  'Ancient Copper Dragon',
  'Ancient Gold Dragon',
  'Ancient Green Dragon',
  'Ancient Red Dragon',
  'Ancient Silver Dragon',
  'Ancient White Dragon',
  'Androsphinx',
  'Animated Armor',
  'Ankheg',
  'Ape',
  'Awakened Shrub',
  'Awakened Tree',
  'Axe Beak',
  'Azer',
  'Baboon',
  'Badger',
  'Balor',
  'Barbed Devil',
  'Basilisk',
  'Bat',
  'Bearded Devil',
  'Behir',
  'Black Bear',
  'Black Dragon Wyrmling',
  'Black Pudding',
  'Blink Dog',
  'Blood Hawk',
  'Blue Dragon Wyrmling',
  'Boar',
  'Bone Devil',
  'Brass Dragon Wyrmling',
  'Bronze Dragon Wyrmling',
  'Brown Bear',
  'Bugbear',
  'Bulette',
  'Camel',
  'Cat',
  'Centaur',
  'Chain Devil',
  'Chimera',
  'Chuul',
  'Clay Golem',
  'Cloaker',
  'Cloud Giant',
  'Cockatrice',
  'Constrictor Snake',
  'Copper Dragon Wyrmling',
  'Couatl',
  'Crab',
  'Crocodile',
  'Darkmantle',
  'Death Dog',
  'Deer',
  'Deva',
  'Dire Wolf',
  'Djinni',
  'Doppelganger',
  'Draft Horse',
  'Dragon Turtle',
  'Dretch',
  'Drider',
  'Dryad',
  'Duergar',
  'Dust Mephit',
  'Eagle',
  'Earth Elemental',
  'Efreeti',
  'Elephant',
  'Elf, Drow',
  'Elk',
  'Erinyes',
  'Ettercap',
  'Ettin',
  'Fire Elemental',
  'Fire Giant',
  'Flesh Golem',
  'Flying Snake',
  'Flying Sword',
  'Frog',
  'Frost Giant',
  'Gargoyle',
  'Gelatinous Cube',
  'Ghast',
  'Ghost',
  'Ghoul',
  'Giant Ape',
  'Giant Badger',
  'Giant Bat',
  'Giant Boar',
  'Giant Centipede',
  'Giant Constrictor Snake',
  'Giant Crab',
  'Giant Crocodile',
  'Giant Eagle',
  'Giant Elk',
  'Giant Fire Beetle',
  'Giant Frog',
  'Giant Goat',
  'Giant Hyena',
  'Giant Lizard',
  'Giant Octopus',
  'Giant Owl',
  'Giant Poisonous Snake',
  'Giant Rat',
  'Giant Scorpion',
  'Giant Sea Horse',
  'Giant Shark',
  'Giant Spider',
  'Giant Toad',
  'Giant Vulture',
  'Giant Wasp',
  'Giant Weasel',
  'Giant Wolf Spider',
  'Gibbering Mouther',
  'Glabrezu',
  'Gnoll',
  'Gnome, Deep (Svirfneblin)',
  'Goat',
  'Goblin',
  'Gold Dragon Wyrmling',
  'Gorgon',
  'Gray Ooze',
  'Green Dragon Wyrmling',
  'Green Hag',
  'Grick',
  'Griffon',
  'Grimlock',
  'Guardian Naga',
  'Gynosphinx',
  'Half-Red Dragon Veteran',
  'Harpy',
  'Hawk',
  'Hell Hound',
  'Hezrou',
  'Hill Giant',
  'Hippogriff',
  'Hobgoblin',
  'Homunculus',
  'Horned Devil',
  'Hunter Shark',
  'Hydra',
  'Hyena',
  'Ice Devil',
  'Ice Mephit',
  'Imp',
  'Invisible Stalker',
  'Iron Golem',
  'Jackal',
  'Killer Whale',
  'Kobold',
  'Kraken',
  'Lamia',
  'Lemure',
  'Lich',
  'Lion',
  'Lizard',
  'Lizardfolk',
  'Magma Mephit',
  'Magmin',
  'Mammoth',
  'Manticore',
  'Marilith',
  'Mastiff',
  'Medusa',
  'Merfolk',
  'Merrow',
  'Mimic',
  'Minotaur',
  'Minotaur Skeleton',
  'Mule',
  'Mummy',
  'Mummy Lord',
  'Nalfeshnee',
  'Night Hag',
  'Nightmare',
  'Ochre Jelly',
  'Octopus',
  'Ogre',
  'Ogre Zombie',
  'Oni',
  'Orc',
  'Otyugh',
  'Owl',
  'Owlbear',
  'Panther',
  'Pegasus',
  'Phase Spider',
  'Pit Fiend',
  'Planetar',
  'Plesiosaurus',
  'Poisonous Snake',
  'Polar Bear',
  'Pony',
  'Pseudodragon',
  'Purple Worm',
  'Quasit',
  'Quipper',
  'Rakshasa',
  'Rat',
  'Raven',
  'Red Dragon Wyrmling',
  'Reef Shark',
  'Remorhaz',
  'Rhinoceros',
  'Riding Horse',
  'Roc',
  'Roper',
  'Rug of Smothering',
  'Rust Monster',
  'Saber-Toothed Tiger',
  'Sahuagin',
  'Salamander',
  'Satyr',
  'Scorpion',
  'Sea Hag',
  'Sea Horse',
  'Shadow',
  'Shambling Mound',
  'Shield Guardian',
  'Shrieker',
  'Silver Dragon Wyrmling',
  'Skeleton',
  'Solar',
  'Specter',
  'Spider',
  'Spirit Naga',
  'Sprite',
  'Steam Mephit',
  'Stirge',
  'Stone Giant',
  'Stone Golem',
  'Storm Giant',
  'Succubus/Incubus',
  'Swarm of Bats',
  'Swarm of Insects',
  'Swarm of Poisonous Snakes',
  'Swarm of Quippers',
  'Swarm of Rats',
  'Swarm of Ravens',
  'Tarrasque',
  'Tiger',
  'Treant',
  'Triceratops',
  'Troll',
  'Tyrannosaurus Rex',
  'Unicorn',
  'Vampire',
  'Vampire Spawn',
  'Violet Fungus',
  'Vrock',
  'Vulture',
  'Warhorse',
  'Warhorse Skeleton',
  'Water Elemental',
  'Weasel',
  'Werebear',
  'Wereboar',
  'Wererat',
  'Weretiger',
  'Werewolf',
  'White Dragon Wyrmling',
  'Wight',
  'Will-o’-Wisp',
  'Winter Wolf',
  'Wolf',
  'Worg',
  'Wraith',
  'Wyvern',
  'Xorn',
  'Young Black Dragon',
  'Young Blue Dragon',
  'Young Brass Dragon',
  'Young Bronze Dragon',
  'Young Copper Dragon',
  'Young Gold Dragon',
  'Young Green Dragon',
  'Young Red Dragon',
  'Young Silver Dragon',
  'Young White Dragon',
  'Zombie',
];

/**
 * Minimum number of base classes a full SRD 5.1 import must yield. The SRD 5.1
 * "Classes" chapter contains the 12 base classes (Barbarian … Wizard). This
 * floor catches a gross extraction regression — an empty or badly-truncated
 * class parse — when the importer runs against the real PDF. The CLI passes this
 * value; fixture-based tests rely on the always-on empty-result guard (or pass a
 * smaller floor). Subclasses and features are separate kinds (ADR 0009) and are
 * not counted here.
 */
export const MIN_EXPECTED_SRD_5_1_CLASSES = 12;

/**
 * Minimum number of subclasses a full SRD 5.1 import must yield. The SRD 5.1
 * publishes exactly one subclass per base class — 12 in total (Path of the
 * Berserker … School of Evocation). This floor catches a gross extraction
 * regression — an empty or badly-truncated subclass parse — when the importer
 * runs against the real PDF (e.g. if the subclass headings drift and the
 * known-name matcher misses them). The CLI passes this value; fixture-based
 * tests rely on the always-on empty-result guard (or pass a smaller floor).
 * Subclasses parse from the same Classes-chapter slice as base classes; see
 * ADR 0009 and loreweaver-0m9.5.17.
 */
export const MIN_EXPECTED_SRD_5_1_SUBCLASSES = 12;

/**
 * Minimum number of class/subclass-granted features a full SRD 5.1 import must
 * yield. The real Classes chapter contains substantially more than one feature
 * per class; this conservative floor catches empty or badly truncated feature
 * parses without trying to be an exact coverage audit.
 */
export const MIN_EXPECTED_SRD_5_1_FEATURES = 12;

/**
 * Race + subrace records the SRD 5.1 PDF publishes. The SRD 5.1 includes the 9
 * base PHB races but only ONE subrace per race-with-subraces (4 subraces total:
 * Hill Dwarf, High Elf, Lightfoot Halfling, Rock Gnome) — the other PHB
 * subraces (Mountain Dwarf, Wood Elf, Dark Elf/Drow, Stout Halfling, Forest
 * Gnome) are not part of the CC-BY-4.0 SRD 5.1. The `parseAncestries`
 * `KNOWN_SUBRACES` list is intentionally broader so the parser still detects
 * those headings in synthetic fixtures or future SRD revisions; this constant
 * is the coverage gate for the real vendored SRD 5.1 PDF specifically.
 */
export const EXPECTED_SRD_5_1_ANCESTRY_NAMES: readonly string[] = [
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
];

/**
 * Thrown when the parsed creature set fails the coverage check: an empty
 * result, a count below `minCreatureCount`, or — when the exact
 * `expectedCreatureNames` set is supplied (the real import) — any missing or
 * unexpected creature name. Distinct from `SectionNotFoundError` so callers can
 * tell "the Monsters section was found but produced the wrong creatures" apart
 * from "the section anchor didn't match".
 */
export class CreatureCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreatureCoverageError';
  }
}

/**
 * Thrown when the parsed class set fails the coverage check (empty result, or
 * fewer classes than `minClassCount`). Distinct from `SectionNotFoundError` so
 * callers can tell "the Classes section was found but produced too few classes"
 * apart from "the section anchor didn't match".
 */
export class ClassCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClassCoverageError';
  }
}

/**
 * Thrown when the parsed subclass set fails the coverage check (empty result,
 * or fewer subclasses than `minSubclassCount`). Distinct from
 * `SectionNotFoundError` so callers can tell "the Classes section was found but
 * produced too few subclasses" apart from "the section anchor didn't match".
 */
export class SubclassCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubclassCoverageError';
  }
}

/**
 * Thrown when the parsed feature set fails the coverage check (empty result, or
 * fewer features than `minFeatureCount`).
 */
export class FeatureCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeatureCoverageError';
  }
}

/**
 * Thrown when the parsed ancestry set fails exact SRD 5.1 name-set coverage.
 * Distinct from `SectionNotFoundError` so callers can tell "the Races section
 * was found but produced too few ancestry records" apart from "the section
 * anchor didn't match".
 */
export class AncestryCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AncestryCoverageError';
  }
}

export interface RunImporterInput {
  /** Absolute path to the vendored SRD 5.1 PDF. */
  readonly pdfPath: string;
  /** Output directory; receives manifest.json + records.json. */
  readonly outDir: string;
  /**
   * Override the default section anchors. Useful when the vendored PDF uses
   * variant chapter headings, or for tests that supply a fixture PDF whose
   * heading text differs.
   */
  readonly sectionAnchors?: Srd51SectionAnchors;
  /**
   * Minimum number of creature stat blocks the Monsters section must yield for
   * the run to be accepted. When set and the parsed count is below it, the
   * importer throws `CreatureCoverageError` and writes nothing. The real-import
   * CLI uses the stronger `expectedCreatureNames` gate instead; fixture
   * pipelines that exercise a reduced Monsters section either omit this
   * (relying on the always-on empty-result guard) or pass a small value. An
   * empty creature result is always rejected regardless of this option.
   */
  readonly minCreatureCount?: number;
  /**
   * Exact set of creature names the Monsters section must yield for the run to
   * be accepted. When provided and the parsed names don't match it exactly, the
   * importer throws `CreatureCoverageError` naming the missing and/or
   * unexpected creatures, and writes nothing. The real-import CLI passes
   * `EXPECTED_SRD_5_1_CREATURE_NAMES`; fixture pipelines that exercise a reduced
   * Monsters section omit this and rely on the empty-result guard (or the
   * coarse `minCreatureCount` floor). An empty creature result is always
   * rejected regardless of this option.
   */
  readonly expectedCreatureNames?: readonly string[];
  /**
   * Minimum number of base classes the Classes section must yield for the run
   * to be accepted. When set and the parsed count is below it, the importer
   * throws `ClassCoverageError` and writes nothing. The real-import CLI passes
   * `MIN_EXPECTED_SRD_5_1_CLASSES`; fixture pipelines either omit this (relying
   * on the always-on empty-result guard) or pass a small value. An empty class
   * result is always rejected regardless of this option.
   */
  readonly minClassCount?: number;
  /**
   * Minimum number of subclasses the Classes section must yield for the run to
   * be accepted. When set and the parsed count is below it, the importer throws
   * `SubclassCoverageError` and writes nothing. The real-import CLI passes
   * `MIN_EXPECTED_SRD_5_1_SUBCLASSES`; fixture pipelines either omit this
   * (relying on the always-on empty-result guard) or pass a small value. An
   * empty subclass result is always rejected regardless of this option.
   */
  readonly minSubclassCount?: number;
  /**
   * Minimum number of class/subclass-granted features the Classes section must
   * yield for the run to be accepted. When set and the parsed count is below
   * it, the importer throws `FeatureCoverageError` and writes nothing. An empty
   * feature result is always rejected regardless of this option.
   */
  readonly minFeatureCount?: number;
}

/**
 * Fail closed on a creature result that can't be a faithful SRD 5.1 import.
 * An empty set is always rejected. When the exact `expectedCreatureNames` set
 * is supplied (the real import), the parsed names must match it exactly —
 * any missing or unexpected creature is rejected, naming the specific
 * offenders so a dropped/renamed creature or a bled-in unrelated stat block
 * trips by name, not just on gross truncation. The coarse `minCreatureCount`
 * floor (when provided) is also enforced for fixture pipelines. Runs after
 * parsing and before any output is written; messages are deterministic so a CI
 * failure is self-explanatory.
 */
function validateCreatureCoverage(
  creatures: readonly CreatureExtraction[],
  minCreatureCount: number | undefined,
  expectedCreatureNames: readonly string[] | undefined,
): void {
  if (creatures.length === 0) {
    throw new CreatureCoverageError(
      'SRD 5.1 creature coverage check failed: the Monsters section was found but yielded 0 creature stat blocks. The Monsters layout likely changed. Refusing to write a pack with no creatures.',
    );
  }
  if (expectedCreatureNames !== undefined) {
    const parsedNames = new Set(creatures.map((creature) => creature.name));
    const expectedSet = new Set(expectedCreatureNames);
    const missing = expectedCreatureNames.filter(
      (name) => !parsedNames.has(name),
    );
    const unexpected = [...parsedNames].filter(
      (name) => !expectedSet.has(name),
    );
    if (missing.length > 0 || unexpected.length > 0) {
      const parts: string[] = [];
      if (missing.length > 0) {
        parts.push(`missing expected creature(s): ${missing.join(', ')}`);
      }
      if (unexpected.length > 0) {
        parts.push(`unexpected creature(s): ${unexpected.join(', ')}`);
      }
      throw new CreatureCoverageError(
        `SRD 5.1 creature coverage check failed: parsed ${creatures.length} creature stat block(s), expected exactly ${expectedCreatureNames.length}. ${parts.join('; ')}. The Monsters section may have been truncated, a creature renamed, or unrelated stat blocks bled in. Refusing to write a pack with a drifted creature set.`,
      );
    }
  }
  if (minCreatureCount !== undefined && creatures.length < minCreatureCount) {
    throw new CreatureCoverageError(
      `SRD 5.1 creature coverage check failed: parsed ${creatures.length} creature stat block(s), expected at least ${minCreatureCount}. The Monsters section may have been truncated or its layout changed.`,
    );
  }
}

/**
 * Fail closed on a class result that can't be a faithful SRD 5.1 import: an
 * empty set is always rejected; a non-empty set below `minClassCount` (when
 * provided) is rejected too. Runs after parsing and before any output is
 * written. Error messages name the observed/expected counts so a CI failure is
 * self-explanatory.
 */
function validateClassCoverage(
  count: number,
  minClassCount: number | undefined,
): void {
  if (count === 0) {
    throw new ClassCoverageError(
      'SRD 5.1 class coverage check failed: the Classes section was found but yielded 0 base classes. The Classes layout likely changed. Refusing to write a pack with no classes.',
    );
  }
  if (minClassCount !== undefined && count < minClassCount) {
    throw new ClassCoverageError(
      `SRD 5.1 class coverage check failed: parsed ${count} base class(es), expected at least ${minClassCount}. The Classes section may have been truncated or its layout changed.`,
    );
  }
}

/**
 * Fail closed on a subclass result that can't be a faithful SRD 5.1 import: an
 * empty set is always rejected; a non-empty set below `minSubclassCount` (when
 * provided) is rejected too. Runs after parsing and before any output is
 * written. Error messages name the observed/expected counts so a CI failure is
 * self-explanatory.
 */
function validateSubclassCoverage(
  count: number,
  minSubclassCount: number | undefined,
): void {
  if (count === 0) {
    throw new SubclassCoverageError(
      'SRD 5.1 subclass coverage check failed: the Classes section was found but yielded 0 subclasses. The subclass headings likely changed. Refusing to write a pack with no subclasses.',
    );
  }
  if (minSubclassCount !== undefined && count < minSubclassCount) {
    throw new SubclassCoverageError(
      `SRD 5.1 subclass coverage check failed: parsed ${count} subclass(es), expected at least ${minSubclassCount}. The Classes section may have been truncated or the subclass headings changed.`,
    );
  }
}

/**
 * Fail closed on a feature result that can't be a faithful SRD 5.1 import: an
 * empty set is always rejected; a non-empty set below `minFeatureCount` (when
 * provided) is rejected too.
 */
function validateFeatureCoverage(
  count: number,
  minFeatureCount: number | undefined,
): void {
  if (count === 0) {
    throw new FeatureCoverageError(
      'SRD 5.1 feature coverage check failed: the Classes section was found but yielded 0 class/subclass features. The class progression tables or feature headings likely changed. Refusing to write a pack with no features.',
    );
  }
  if (minFeatureCount !== undefined && count < minFeatureCount) {
    throw new FeatureCoverageError(
      `SRD 5.1 feature coverage check failed: parsed ${count} feature(s), expected at least ${minFeatureCount}. The Classes section may have been truncated or its progression tables changed.`,
    );
  }
}

/**
 * Fail closed on ancestry under-extraction. Unlike the creature/class count
 * floors, the SRD 5.1 race/subrace name set is small and stable enough to
 * validate exactly. Runs after parsing and before any output is written.
 */
function validateAncestryCoverage(
  ancestries: readonly AncestryExtraction[],
): void {
  const parsedNames = new Set(ancestries.map((ancestry) => ancestry.name));
  const missing = EXPECTED_SRD_5_1_ANCESTRY_NAMES.filter(
    (name) => !parsedNames.has(name),
  );
  if (missing.length === 0) return;

  throw new AncestryCoverageError(
    `SRD 5.1 ancestry coverage check failed: parsed ${ancestries.length} ancestry record(s), expected ${EXPECTED_SRD_5_1_ANCESTRY_NAMES.length}. Missing expected ancestry record(s): ${missing.join(', ')}. The Races section may have been truncated or its headings changed. Refusing to write a pack with incomplete ancestries.`,
  );
}

export async function runImporter(
  input: RunImporterInput,
): Promise<ImporterRunResult> {
  const pdfBytes = readFileSync(input.pdfPath);
  const sourceHash = sha256Hex(pdfBytes);
  const pages = await extractPdfText(new Uint8Array(pdfBytes));

  const anchors = input.sectionAnchors ?? SRD_5_1_DEFAULT_SECTION_ANCHORS;
  const coreRulePages = sliceSection(pages, anchors.coreRules);
  // Throws SectionNotFoundError if either spell anchor doesn't match.
  const spellDescriptionPages = sliceSection(pages, anchors.spellDescriptions);
  const spellListPages = sliceSection(pages, anchors.spellLists);

  // Throws SectionNotFoundError if the conditions anchor doesn't match.
  // Conditions is an implemented kind; the importer must fail closed rather
  // than silently emit a pack that omits conditions because the PDF changed.
  const conditionPages = sliceSection(pages, anchors.conditions);
  const combatActionPages = sliceSection(pages, anchors.combatActions);

  const spells = parseSpells(spellDescriptionPages);
  const classIndex = parseSpellClassLists(spellListPages);
  // Throws SectionNotFoundError if the monsters start OR end anchor doesn't
  // match — creature is an implemented kind, so fail closed rather than emit a
  // pack without creatures or let trailing content bleed in (the monsters
  // anchor sets requireEndHeading: true); see the anchor comment in sections.ts.
  //
  // SRD 5.1 splits creature stat blocks across the main Monsters chapter
  // (p254-357: the alphabetic A-Z entries) AND Appendix MM-A: Miscellaneous
  // Creatures (p366-394: animals/beasts like Wolf, Cat, Bear that are not in
  // the main chapter). Parse the union via a single parseCreatures call so
  // both sets land in the same sorted output; the misc-creatures anchor is
  // best-effort so fixture PDFs without that appendix still import cleanly
  // (loreweaver-w8h). Appendix MM-B: Nonplayer Characters remains out of
  // scope — the misc-creatures end anchor stops at it explicitly.
  const monsterPages = sliceSection(pages, anchors.monsters);
  const miscCreaturePages = sliceSectionOrEmptyPages(
    pages,
    anchors.miscellaneousCreatures,
  );
  const creatures = parseCreatures([...monsterPages, ...miscCreaturePages]);
  // Fail closed before any output is written if creature extraction is empty,
  // implausibly small (coarse floor), or — for the real import — does not match
  // the exact expected SRD 5.1 creature name set.
  validateCreatureCoverage(
    creatures,
    input.minCreatureCount,
    input.expectedCreatureNames,
  );
  const conditions = parseConditions(conditionPages);
  const actions = parseActions(combatActionPages);
  const featPages = sliceSection(pages, anchors.feats);
  const feats = parseFeats(featPages);
  // SRD 5.1 has no hazards chapter (the Brown Mold / Green Slime / Webs /
  // Yellow Mold entries are not part of the SRD 5.1 PDF) — emit an empty
  // hazard set when the anchor fails. Same shape as the multiclassing
  // best-effort fall-through below.
  const hazards = sliceSectionOrEmpty(pages, anchors.hazards, parseHazards);
  const equipmentPages = sliceSection(pages, anchors.equipment);
  // Mounts and Vehicles sits just after the Equipment chapter's tables (the
  // equipment anchor's endHeading), so it is its own slice parsed by
  // parseMountsAndVehicles and concatenated with the equipment records
  // (loreweaver-4zu). Best-effort like hazards/treasure: reduced fixture PDFs
  // that carry the Equipment chapter but no Mounts and Vehicles section degrade
  // to no mount/vehicle records (a missing START anchor returns empty). The
  // anchor leaves requireEndHeading off because parseMountsAndVehicles is
  // internally header-bounded (see sections.ts), so a missing end cannot
  // over-extract.
  const equipment = [
    ...parseEquipment(equipmentPages),
    ...sliceSectionOrEmpty(
      pages,
      anchors.mountsAndVehicles,
      parseMountsAndVehicles,
    ),
  ];
  // SRD 5.1 has no standalone treasure-tables chapter either. Best-effort.
  const treasureTablePages = sliceSectionOrEmptyPages(
    pages,
    anchors.treasureTables,
  );
  const rules = parseRules(coreRulePages);
  const tables = parseTables([...coreRulePages, ...treasureTablePages]);
  // Sliced after the other sections so the existing fail-closed tests trip on
  // their own anchor first. Throws SectionNotFoundError if the races anchor
  // doesn't match — ancestry is an implemented kind, so fail closed rather than
  // emit a pack without races.
  const racePages = sliceSection(pages, anchors.races);
  const ancestries = parseAncestries(racePages);
  validateAncestryCoverage(ancestries);
  // Throws SectionNotFoundError if the classes start OR end anchor doesn't
  // match — class is an implemented kind, so fail closed rather than emit a
  // pack without classes (the classes anchor sets requireEndHeading: true).
  const classPages = sliceSection(pages, anchors.classes);
  const classes = parseClasses(classPages);
  // Fail closed before any output is written if class extraction is empty or
  // (when a floor is supplied) implausibly small. Class is an implemented kind.
  validateClassCoverage(classes.length, input.minClassCount);
  // Subclasses (Champion, Life domain, …) live inside the Classes chapter, so
  // they parse from the same slice. See ADR 0009 and loreweaver-0m9.5.17.
  const subclasses = parseSubclasses(classPages);
  // Fail closed before any output is written if subclass extraction is empty or
  // (when a floor is supplied) implausibly small. Subclass is an implemented
  // kind, so a Classes section that yields base classes but no subclasses must
  // not silently produce a pack that omits `subclass` from the manifest.
  validateSubclassCoverage(subclasses.length, input.minSubclassCount);
  // Class- and subclass-granted features parse from the same Classes-chapter
  // slice (ADR 0009 / loreweaver-0m9.5.18).
  const features = parseFeatures(classPages);
  validateFeatureCoverage(features.length, input.minFeatureCount);
  // Best-effort enrichment: the SRD Class Features block carries no primary-
  // ability line, so per-class primary abilities come from the Multiclassing
  // prerequisites listing (loreweaver-0m9.5.19). This is NOT fail-closed — per
  // ADR 0007 a missing source value is left empty rather than authored, so a
  // PDF without a locatable Multiclassing section simply yields empty
  // primaryAbilities (the prior behavior) instead of throwing.
  let primaryAbilityIndex: ClassPrimaryAbilityIndex = new Map();
  try {
    const multiclassingPages = sliceSection(pages, anchors.multiclassing);
    primaryAbilityIndex = parseMulticlassing(multiclassingPages);
  } catch (error) {
    if (!(error instanceof SectionNotFoundError)) throw error;
    // Multiclassing section absent: leave primaryAbilities empty.
  }
  const pack = buildPack({
    spells,
    classIndex,
    primaryAbilityIndex,
    creatures,
    classes,
    subclasses,
    features,
    conditions,
    feats,
    hazards,
    actions,
    rules,
    tables,
    equipment,
    ancestries,
    sourceHash,
  });
  writePackToDirectory(pack, { outDir: input.outDir });
  return {
    outDir: input.outDir,
    sourceHash,
    counts: {
      spells: spells.length,
      creatures: creatures.length,
      classes: classes.length,
      subclasses: subclasses.length,
      features: features.length,
      conditions: conditions.length,
      feats: feats.length,
      hazards: hazards.length,
      actions: actions.length,
      rules: rules.length,
      tables: tables.length,
      equipment: equipment.length,
      ancestries: ancestries.length,
    },
  };
}

function sha256Hex(bytes: Uint8Array | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Slice a section and run its parser, but degrade to an empty result list if
 * the section START heading is absent. Used for kinds whose section is
 * absent from the SRD 5.1 PDF entirely (hazards, treasure tables) —
 * fail-closed parsing would refuse a perfectly valid run on the canonical
 * source.
 *
 * Critically, this only catches `SectionNotFoundError('start', ...)`. If
 * the start anchor matches but the requireEndHeading guard fires (a real
 * boundary failure that would let trailing content bleed into the parser),
 * the error still propagates. Coverage / schema / other errors also
 * propagate.
 */
function sliceSectionOrEmpty<T>(
  pages: readonly import('./types.js').PageText[],
  anchor: SectionAnchorOptions,
  parse: (slice: readonly import('./types.js').PageText[]) => T[],
): T[] {
  try {
    const slice = sliceSection(pages, anchor);
    return parse(slice);
  } catch (error) {
    if (error instanceof SectionNotFoundError && error.which === 'start') {
      return [];
    }
    throw error;
  }
}

/**
 * Pages-only variant for `treasureTables` — it feeds into `parseTables`
 * alongside the core-rules slice rather than being parsed in isolation.
 * Same fail-closed boundaries as `sliceSectionOrEmpty`: only a missing
 * start heading degrades to empty; a missing required end heading still
 * throws.
 */
function sliceSectionOrEmptyPages(
  pages: readonly import('./types.js').PageText[],
  anchor: SectionAnchorOptions,
): readonly import('./types.js').PageText[] {
  try {
    return sliceSection(pages, anchor);
  } catch (error) {
    if (error instanceof SectionNotFoundError && error.which === 'start') {
      return [];
    }
    throw error;
  }
}
