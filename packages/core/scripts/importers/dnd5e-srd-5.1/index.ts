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
 * nothing.
 *
 * Scope today: spells, creatures, base classes, conditions, feats, hazards,
 * actions, rules, tables, equipment, and ancestries (races + subraces).
 * Subclasses and class features are separate record kinds tracked under
 * loreweaver-0m9.5.15-18 (see ADR 0008) and are not parsed here.
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
import { parseHazards } from './parseHazards.js';
import { parseRules } from './parseRules.js';
import { parseSpellClassLists, parseSpells } from './parseSpells.js';
import { parseTables } from './parseTables.js';
import {
  SRD_5_1_DEFAULT_SECTION_ANCHORS,
  type Srd51SectionAnchors,
  sliceSection,
} from './sections.js';
import type { ImporterRunResult } from './types.js';

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
  const hazardPages = sliceSection(pages, anchors.hazards);
  const hazards = parseHazards(hazardPages);
  const equipmentPages = sliceSection(pages, anchors.equipment);
  const equipment = parseEquipment(equipmentPages);
  const treasureTablePages = sliceSection(pages, anchors.treasureTables);
  const rules = parseRules(coreRulePages);
  const tables = parseTables([...coreRulePages, ...treasureTablePages]);
  // Sliced after the other sections so the existing fail-closed tests trip on
  // their own anchor first. Throws SectionNotFoundError if the races anchor
  // doesn't match — ancestry is an implemented kind, so fail closed rather than
  // emit a pack without races.
  const racePages = sliceSection(pages, anchors.races);
  const ancestries = parseAncestries(racePages);
  // Throws SectionNotFoundError if the classes start OR end anchor doesn't
  // match — class is an implemented kind, so fail closed rather than emit a
  // pack without classes (the classes anchor sets requireEndHeading: true).
  const classPages = sliceSection(pages, anchors.classes);
  const classes = parseClasses(classPages);
  const pack = buildPack({
    spells,
    classIndex,
    creatures,
    classes,
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
