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
 * (or one below `minCreatureCount`) throws `CreatureCoverageError` and writes
 * nothing. The ancestry set is guarded by exact SRD 5.1 expected-name coverage
 * so a valid Races slice cannot silently under-extract race/subrace records.
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
import { parseEquipment } from './parseEquipment.js';
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
  ImporterRunResult,
} from './types.js';

/**
 * Minimum number of creature stat blocks a full SRD 5.1 import must yield. The
 * SRD 5.1 "Monsters" chapter contains on the order of 300+ creature stat blocks
 * (the separate "Nonplayer Characters" section is intentionally out of scope —
 * see the `monsters` section anchor in `sections.ts`). This floor exists to
 * catch a gross extraction regression — an empty or badly-truncated run — when
 * the importer is pointed at the real PDF. It is deliberately a count floor
 * rather than an exact name set: enumerating the full name set by hand is
 * error-prone without the vendored PDF, and exact-coverage validation is
 * tracked separately in `loreweaver-0m9.5.14`. The CLI passes this value;
 * fixture-based tests use the always-on empty-result guard instead (or pass a
 * smaller `minCreatureCount`).
 */
export const MIN_EXPECTED_SRD_5_1_CREATURES = 300;

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
  'Mountain Dwarf',
  'High Elf',
  'Wood Elf',
  'Dark Elf (Drow)',
  'Lightfoot Halfling',
  'Stout Halfling',
  'Forest Gnome',
  'Rock Gnome',
];

/**
 * Thrown when the parsed creature set fails the coverage check (empty result,
 * or fewer creatures than `minCreatureCount`). Distinct from
 * `SectionNotFoundError` so callers can tell "the Monsters section was found
 * but produced too few creatures" apart from "the section anchor didn't match".
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
   * CLI passes `MIN_EXPECTED_SRD_5_1_CREATURES`; fixture pipelines that exercise
   * a reduced Monsters section either omit this (relying on the always-on
   * empty-result guard) or pass a small value. An empty creature result is
   * always rejected regardless of this option.
   */
  readonly minCreatureCount?: number;
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
 * Fail closed on a creature result that can't be a faithful SRD 5.1 import:
 * an empty set is always rejected; a non-empty set below `minCreatureCount`
 * (when provided) is rejected too. Runs after parsing and before any output is
 * written. Error messages are deterministic and name the observed/expected
 * counts so a CI failure is self-explanatory.
 */
function validateCreatureCoverage(
  count: number,
  minCreatureCount: number | undefined,
): void {
  if (count === 0) {
    throw new CreatureCoverageError(
      'SRD 5.1 creature coverage check failed: the Monsters section was found but yielded 0 creature stat blocks. The Monsters layout likely changed. Refusing to write a pack with no creatures.',
    );
  }
  if (minCreatureCount !== undefined && count < minCreatureCount) {
    throw new CreatureCoverageError(
      `SRD 5.1 creature coverage check failed: parsed ${count} creature stat block(s), expected at least ${minCreatureCount}. The Monsters section may have been truncated or its layout changed. (Exact name-set coverage is tracked in loreweaver-0m9.5.14.)`,
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
  const monsterPages = sliceSection(pages, anchors.monsters);
  const creatures = parseCreatures(monsterPages);
  // Fail closed before any output is written if creature extraction is empty
  // or (when a floor is supplied) implausibly small.
  validateCreatureCoverage(creatures.length, input.minCreatureCount);
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
  const equipment = parseEquipment(equipmentPages);
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
