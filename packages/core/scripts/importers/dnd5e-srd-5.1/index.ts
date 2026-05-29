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
 * unrelated chapters bleed into the last spell's body).
 *
 * Scope today: spells, creatures, conditions, feats, hazards, actions, rules,
 * tables, equipment, and ancestries (races + subraces).
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
  // Throws SectionNotFoundError if the monsters start anchor doesn't match —
  // creature is an implemented kind, so fail closed rather than emit a pack
  // without creatures. The section may run to EOF (no requireEndHeading); see
  // the anchor comment in sections.ts.
  const monsterPages = sliceSection(pages, anchors.monsters);
  const creatures = parseCreatures(monsterPages);
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
  const pack = buildPack({
    spells,
    classIndex,
    creatures,
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
