/**
 * Reference-table parser for the D&D 5e SRD 5.1 importer.
 *
 * PDF text extraction does not preserve table semantics, so this parser stays
 * deliberately narrow: row-regex reconstruction for the simple reference
 * tables and column-block reconstruction for the treasure challenge tables.
 *
 * Twenty-three tables are present in the vendored SRD 5.1 PDF: Difficulty
 * Classes, two trap tables, three Madness effect tables, the Object Armor
 * Class / Object Hit Points tables, the six "Beyond 1st Level" reference
 * tables (Character Advancement, Multiclassing Prerequisites, Multiclassing
 * Proficiencies, Standard Languages, Exotic Languages — eshyra-0m9.23 — and
 * Multiclass Spellcaster: Spell Slots per Spell Level — eshyra-0m9.18), the
 * five money/downtime tables (Standard Exchange Rates, Trade Goods, Lifestyle
 * Expenses, Food/Drink/Lodging, Services; eshyra-0m9.19), and the four
 * Monsters-chapter reference tables (Size Categories, Hit Dice by Size,
 * Proficiency Bonus by Challenge Rating, Experience Points by Challenge
 * Rating; eshyra-0m9.22). XP-threshold and treasure-table reconstruction
 * rules match no section in this source and remain fixture-only. See the
 * importer README's "Reference-table coverage" section.
 */

import type { PageText, TableExtraction } from './types.js';

interface FlatLine {
  readonly line: string;
  readonly page: number;
}

interface Anchor {
  readonly idx: number;
  readonly page: number;
}

function flatten(pages: readonly PageText[]): readonly FlatLine[] {
  const out: FlatLine[] = [];
  for (const page of pages) {
    for (const line of page.lines) {
      out.push({ line, page: page.pageNumber });
    }
  }
  return out;
}

function findAnchor(
  flat: readonly FlatLine[],
  pattern: RegExp,
): Anchor | undefined {
  for (let i = 0; i < flat.length; i++) {
    if (pattern.test(flat[i].line.trim())) {
      return { idx: i, page: flat[i].page };
    }
  }
  return undefined;
}

const MAX_TABLE_SCAN_LINES = 80;

function collectRows(
  flat: readonly FlatLine[],
  startIdx: number,
  parseRow: (line: string) => readonly unknown[] | undefined,
): readonly (readonly unknown[])[] {
  const rows: (readonly unknown[])[] = [];
  const end = Math.min(flat.length, startIdx + MAX_TABLE_SCAN_LINES);
  for (let i = startIdx; i < end; i++) {
    const line = flat[i].line.trim();
    const row = parseRow(line);
    if (row !== undefined) {
      rows.push(row);
      continue;
    }
    if (rows.length > 0) {
      break;
    }
  }
  return rows;
}

const DIFFICULTY_CLASSES_ANCHOR = /^(Typical )?Difficulty Classes$/i;
const DIFFICULTY_CLASSES_ROW =
  /^(Very easy|Easy|Medium|Hard|Very hard|Nearly impossible)\s+(\d+)$/i;

function parseDifficultyClassRow(
  line: string,
): readonly [string, number] | undefined {
  const match = DIFFICULTY_CLASSES_ROW.exec(line);
  if (match === null) return undefined;
  return [match[1], Number.parseInt(match[2], 10)];
}

function parseDifficultyClasses(
  flat: readonly FlatLine[],
): TableExtraction | undefined {
  const anchor = findAnchor(flat, DIFFICULTY_CLASSES_ANCHOR);
  if (anchor === undefined) return undefined;
  const rows = collectRows(flat, anchor.idx + 1, parseDifficultyClassRow);
  if (rows.length === 0) return undefined;
  return {
    name: 'Difficulty Classes',
    columns: ['Task Difficulty', 'DC'],
    rows,
    sourcePage: anchor.page,
  };
}

// Both trap reference tables live in the gamemastering "Traps" section (p196),
// fed into `parseTables` via the `traps` slice (loreweaver-hvp). Each is a
// fixed-row table whose cells survive PDF extraction as one space-separated
// line, so a per-row regex reconstructs them deterministically — the same shape
// as Difficulty Classes. Cell text is preserved verbatim, including the en-dash
// ranges ("10–11", "1st–4th"), which are legitimate SRD punctuation.
const TRAP_SAVE_DCS_ANCHOR = /^Trap Save DCs and Attack Bonuses$/i;
const TRAP_SAVE_DCS_ROW =
  /^(Setback|Dangerous|Deadly)\s+(\d+\s*[-–—]\s*\d+)\s+(\+\d+ to \+\d+)$/i;

function parseTrapSaveDcRow(
  line: string,
): readonly [string, string, string] | undefined {
  const match = TRAP_SAVE_DCS_ROW.exec(line);
  if (match === null) return undefined;
  return [match[1], match[2], match[3]];
}

function parseTrapSaveDcs(
  flat: readonly FlatLine[],
): TableExtraction | undefined {
  const anchor = findAnchor(flat, TRAP_SAVE_DCS_ANCHOR);
  if (anchor === undefined) return undefined;
  const rows = collectRows(flat, anchor.idx + 1, parseTrapSaveDcRow);
  if (rows.length === 0) return undefined;
  return {
    name: 'Trap Save DCs and Attack Bonuses',
    columns: ['Trap Danger', 'Save DC', 'Attack Bonus'],
    rows,
    sourcePage: anchor.page,
  };
}

const DAMAGE_SEVERITY_ANCHOR = /^Damage Severity by Level$/i;
const DAMAGE_SEVERITY_ROW =
  /^(\d+(?:st|nd|rd|th)\s*[-–—]\s*\d+(?:st|nd|rd|th))\s+(\d+d\d+)\s+(\d+d\d+)\s+(\d+d\d+)$/i;

function parseDamageSeverityRow(
  line: string,
): readonly [string, string, string, string] | undefined {
  const match = DAMAGE_SEVERITY_ROW.exec(line);
  if (match === null) return undefined;
  return [match[1], match[2], match[3], match[4]];
}

function parseDamageSeverity(
  flat: readonly FlatLine[],
): TableExtraction | undefined {
  const anchor = findAnchor(flat, DAMAGE_SEVERITY_ANCHOR);
  if (anchor === undefined) return undefined;
  const rows = collectRows(flat, anchor.idx + 1, parseDamageSeverityRow);
  if (rows.length === 0) return undefined;
  return {
    name: 'Damage Severity by Level',
    columns: ['Character Level', 'Setback', 'Dangerous', 'Deadly'],
    rows,
    sourcePage: anchor.page,
  };
}

const MADNESS_TABLE_BOUNDARY =
  /^(Short-Term Madness|Long-Term Madness|Indefinite Madness|Curing Madness|Objects|Poisons)$/i;
const D100_ROW_START = /^(\d{2,3}\s*[-–—]\s*\d{1,3})\s+(.+)$/;

function joinWrappedCell(parts: readonly string[]): string {
  let out = '';
  for (const raw of parts) {
    const part = normalizeWhitespace(raw);
    if (part.length === 0) continue;
    if (out.endsWith('-') && /^[a-z]/.test(part)) {
      out += part;
    } else {
      out += `${out.length === 0 ? '' : ' '}${part}`;
    }
  }
  return out;
}

function parseMadnessTable(
  flat: readonly FlatLine[],
  input: {
    readonly anchorPattern: RegExp;
    readonly name: string;
    readonly valueColumn: 'Effect' | 'Flaw';
    readonly expectedRows: number;
  },
): TableExtraction | undefined {
  const anchor = findAnchor(flat, input.anchorPattern);
  if (anchor === undefined) return undefined;

  const rows: [string, string][] = [];
  let currentRange: string | undefined;
  let currentText: string[] = [];
  const flush = (): void => {
    if (currentRange === undefined) return;
    rows.push([currentRange, joinWrappedCell(currentText)]);
    currentRange = undefined;
    currentText = [];
  };

  const end = Math.min(flat.length, anchor.idx + MAX_TABLE_SCAN_LINES);
  for (let i = anchor.idx + 1; i < end; i++) {
    const line = flat[i].line.trim();
    if (line.length === 0 || /^d100\s+(Effect|Flaw)\b/i.test(line)) {
      continue;
    }
    if (MADNESS_TABLE_BOUNDARY.test(line)) {
      break;
    }
    const rowStart = D100_ROW_START.exec(line);
    if (rowStart !== null) {
      flush();
      currentRange = normalizeWhitespace(rowStart[1]);
      currentText = [rowStart[2]];
      continue;
    }
    if (currentRange !== undefined) {
      currentText.push(line);
    }
  }
  flush();

  if (rows.length !== input.expectedRows) return undefined;
  return {
    name: input.name,
    columns: ['d100', input.valueColumn],
    rows,
    sourcePage: anchor.page,
  };
}

const OBJECT_ARMOR_CLASS_ANCHOR = /^Object Armor Class$/i;
const OBJECT_ARMOR_CLASS_ROW =
  /^(Cloth, paper, rope|Crystal, glass, ice|Wood, bone|Stone|Iron, steel|Mithral|Adamantine)\s+(\d+)$/i;

function parseObjectArmorClassRow(
  line: string,
): readonly [string, number] | undefined {
  const match = OBJECT_ARMOR_CLASS_ROW.exec(line);
  if (match === null) return undefined;
  return [match[1], Number.parseInt(match[2], 10)];
}

function parseObjectArmorClass(
  flat: readonly FlatLine[],
): TableExtraction | undefined {
  const anchor = findAnchor(flat, OBJECT_ARMOR_CLASS_ANCHOR);
  if (anchor === undefined) return undefined;
  const rows = collectRows(flat, anchor.idx + 1, parseObjectArmorClassRow);
  if (rows.length !== 7) return undefined;
  return {
    name: 'Object Armor Class',
    columns: ['Substance', 'AC'],
    rows,
    sourcePage: anchor.page,
  };
}

const OBJECT_HIT_POINTS_ANCHOR = /^Object Hit Points$/i;
const OBJECT_HIT_POINTS_SIZE_ROW = /^(Tiny|Small|Medium|Large)\s+(\([^)]*\))$/i;
const OBJECT_HIT_POINTS_VALUE_ROW =
  /^(\d+\s+\(\d+d\d+\))\s+(\d+\s+\(\d+d\d+\))$/i;
const OBJECT_HIT_POINTS_INLINE_ROW =
  /^(Tiny|Small|Medium|Large)\s+(\([^)]*\))\s+(\d+\s+\(\d+d\d+\))\s+(\d+\s+\(\d+d\d+\))$/i;

function parseObjectHitPoints(
  flat: readonly FlatLine[],
): TableExtraction | undefined {
  const anchor = findAnchor(flat, OBJECT_HIT_POINTS_ANCHOR);
  if (anchor === undefined) return undefined;
  const sizes: string[] = [];
  const values: [string, string][] = [];
  const inlineRows: [string, string, string][] = [];
  let inValueBlock = false;
  const end = Math.min(flat.length, anchor.idx + MAX_TABLE_SCAN_LINES);
  for (let i = anchor.idx + 1; i < end; i++) {
    const line = flat[i].line.trim();
    const inlineMatch = OBJECT_HIT_POINTS_INLINE_ROW.exec(line);
    if (inlineMatch !== null) {
      inlineRows.push([
        `${inlineMatch[1]} ${inlineMatch[2]}`,
        normalizeWhitespace(inlineMatch[3]),
        normalizeWhitespace(inlineMatch[4]),
      ]);
      if (inlineRows.length === 4) break;
      continue;
    }
    if (/^Fragile Resilient$/i.test(line)) {
      inValueBlock = true;
      continue;
    }
    if (inValueBlock) {
      const valueMatch = OBJECT_HIT_POINTS_VALUE_ROW.exec(line);
      if (valueMatch !== null) {
        values.push([
          normalizeWhitespace(valueMatch[1]),
          normalizeWhitespace(valueMatch[2]),
        ]);
        if (values.length === 4) break;
      }
      continue;
    }
    const sizeMatch = OBJECT_HIT_POINTS_SIZE_ROW.exec(line);
    if (sizeMatch !== null) {
      sizes.push(`${sizeMatch[1]} ${sizeMatch[2]}`);
    }
  }
  if (inlineRows.length > 0) {
    if (inlineRows.length !== 4) return undefined;
    return {
      name: 'Object Hit Points',
      columns: ['Size', 'Fragile', 'Resilient'],
      rows: inlineRows,
      sourcePage: anchor.page,
    };
  }
  if (sizes.length !== 4 || values.length !== 4) return undefined;
  const rows = sizes.map((size, i): readonly [string, string, string] => [
    size,
    values[i][0],
    values[i][1],
  ]);
  return {
    name: 'Object Hit Points',
    columns: ['Size', 'Fragile', 'Resilient'],
    rows,
    sourcePage: anchor.page,
  };
}

const XP_THRESHOLDS_ANCHOR =
  /^(XP Thresholds by Character Level|Experience Point Thresholds by Character Level)$/i;
const XP_THRESHOLDS_ROW =
  /^(\d+(?:st|nd|rd|th)?)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)$/i;

function parseIntegerCell(value: string): number {
  return Number.parseInt(value.replace(/,/g, ''), 10);
}

function parseXpThresholdRow(
  line: string,
): readonly [string, number, number, number, number] | undefined {
  const match = XP_THRESHOLDS_ROW.exec(line);
  if (match === null) return undefined;
  return [
    match[1],
    parseIntegerCell(match[2]),
    parseIntegerCell(match[3]),
    parseIntegerCell(match[4]),
    parseIntegerCell(match[5]),
  ];
}

function parseXpThresholds(
  flat: readonly FlatLine[],
): TableExtraction | undefined {
  const anchor = findAnchor(flat, XP_THRESHOLDS_ANCHOR);
  if (anchor === undefined) return undefined;
  const rows = collectRows(flat, anchor.idx + 1, parseXpThresholdRow);
  if (rows.length === 0) return undefined;
  return {
    name: 'XP Thresholds by Character Level',
    columns: ['Character Level', 'Easy', 'Medium', 'Hard', 'Deadly'],
    rows,
    sourcePage: anchor.page,
  };
}

const TREASURE_TABLE_ANCHOR =
  /^(Individual Treasure|Treasure Hoard): Challenge\s+.+$/i;
const TREASURE_TABLE_END_HEADING = /^Using (a )?Magic Items?$/i;
const D100_RANGE = /^\d{2,3}\s*[-\u2013\u2014]\s*\d{1,3}$/;
const EMPTY_TREASURE_CELL = /^[-\u2013\u2014]+$/;

function parseTreasureTables(flat: readonly FlatLine[]): TableExtraction[] {
  const tables: TableExtraction[] = [];
  for (let i = 0; i < flat.length; i++) {
    const line = flat[i].line.trim();
    if (TREASURE_TABLE_ANCHOR.test(line) === false) {
      continue;
    }
    const table = parseTreasureColumnBlockTable(flat, {
      idx: i,
      page: flat[i].page,
    });
    if (table !== undefined) {
      tables.push(table);
    }
  }
  return tables;
}

function parseTreasureColumnBlockTable(
  flat: readonly FlatLine[],
  anchor: Anchor,
): TableExtraction | undefined {
  const scanLines = collectTreasureTableLines(flat, anchor.idx + 1);
  const firstRangeIdx = scanLines.findIndex(isD100Range);
  if (firstRangeIdx <= 0) {
    return undefined;
  }

  const columns = normalizeTreasureColumns(scanLines.slice(0, firstRangeIdx));
  if (columns.length < 2 || columns[0].toLowerCase() !== 'd100') {
    return undefined;
  }

  const rowCount = countLeadingD100Ranges(scanLines, firstRangeIdx);
  if (rowCount === 0) {
    return undefined;
  }
  const ranges = scanLines.slice(firstRangeIdx, firstRangeIdx + rowCount);
  const cellStartIdx = firstRangeIdx + rowCount;
  const requiredCellCount = rowCount * (columns.length - 1);
  const cellLines = scanLines.slice(
    cellStartIdx,
    cellStartIdx + requiredCellCount,
  );
  if (cellLines.length < requiredCellCount) {
    return undefined;
  }

  const rows = ranges.slice(0, rowCount).map((range, rowIdx) => {
    const row: unknown[] = [normalizeRangeCell(range)];
    for (let columnIdx = 1; columnIdx < columns.length; columnIdx++) {
      const cellIdx = (columnIdx - 1) * rowCount + rowIdx;
      row.push(normalizeTreasureCell(cellLines[cellIdx]));
    }
    return row;
  });

  return {
    name: normalizeTreasureTableName(flat[anchor.idx].line),
    columns,
    rows,
    sourcePage: anchor.page,
  };
}

function collectTreasureTableLines(
  flat: readonly FlatLine[],
  startIdx: number,
): string[] {
  const lines: string[] = [];
  const end = Math.min(flat.length, startIdx + MAX_TABLE_SCAN_LINES);
  for (let i = startIdx; i < end; i++) {
    const line = flat[i].line.trim();
    if (line.length === 0) {
      continue;
    }
    if (
      TREASURE_TABLE_ANCHOR.test(line) ||
      TREASURE_TABLE_END_HEADING.test(line)
    ) {
      break;
    }
    lines.push(line);
  }
  return lines;
}

function countLeadingD100Ranges(
  lines: readonly string[],
  startIdx: number,
): number {
  let count = 0;
  for (let i = startIdx; i < lines.length; i++) {
    if (isD100Range(lines[i]) === false) {
      break;
    }
    count++;
  }
  return count;
}

function isD100Range(line: string): boolean {
  return D100_RANGE.test(line.trim());
}

function normalizeTreasureColumns(lines: readonly string[]): string[] {
  const columns: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = normalizeWhitespace(lines[i]);
    const next =
      lines[i + 1] === undefined
        ? undefined
        : normalizeWhitespace(lines[i + 1]);
    if (
      /^Gems or$/i.test(line) &&
      next !== undefined &&
      /^Art Objects$/i.test(next)
    ) {
      columns.push('Gems or Art Objects');
      i++;
      continue;
    }
    columns.push(line);
  }
  return columns;
}

function normalizeTreasureTableName(line: string): string {
  return normalizeWhitespace(line)
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s*-\s*/g, '-');
}

function normalizeRangeCell(line: string): string {
  return normalizeTreasureTableName(line).replace(/\s*-\s*/g, '-');
}

function normalizeTreasureCell(line: string): string | null {
  const normalized = normalizeWhitespace(line)
    .replace(/\u00d7/g, 'x')
    .replace(/[\u2013\u2014]/g, '-');
  if (EMPTY_TREASURE_CELL.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeWhitespace(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

// --- "Beyond 1st Level" chapter reference tables (p56-59, eshyra-0m9.23) -----
//
// The Character Advancement, Multiclassing, and Languages tables all live in
// the SRD 5.1 "Beyond 1st Level" chapter and survive PDF extraction as
// space-separated per-row lines, the same shape as the simple reference tables
// above. Each table title and column-header line is unique in the chapter
// slice, so the per-table anchors below cannot collide with body prose (the
// prose mentions wrap across two lines, e.g. "as shown in the Character /
// Advancement table"). Cell text is preserved verbatim, including the em-dash
// "—" used for the Sorcerer/Wizard "no proficiencies" and Deep Speech "no
// script" cells.

// Character Advancement: experience-point / level / proficiency-bonus rows.
// XP values carry thousands separators ("2,700"), preserved as integers.
const CHARACTER_ADVANCEMENT_ANCHOR = /^Character Advancement$/i;
const CHARACTER_ADVANCEMENT_ROW = /^([\d,]+)\s+(\d+)\s+(\+\d+)$/;

function parseCharacterAdvancementRow(
  line: string,
): readonly [number, number, string] | undefined {
  const match = CHARACTER_ADVANCEMENT_ROW.exec(line);
  if (match === null) return undefined;
  return [parseIntegerCell(match[1]), Number.parseInt(match[2], 10), match[3]];
}

function parseCharacterAdvancement(
  flat: readonly FlatLine[],
): TableExtraction | undefined {
  const anchor = findAnchor(flat, CHARACTER_ADVANCEMENT_ANCHOR);
  if (anchor === undefined) return undefined;
  const rows = collectRows(flat, anchor.idx + 1, parseCharacterAdvancementRow);
  // The SRD advancement track is exactly 20 levels; a short parse means the
  // extraction drifted, so fail this table rather than emit a partial track.
  if (rows.length !== 20) return undefined;
  return {
    name: 'Character Advancement',
    columns: ['Experience Points', 'Level', 'Proficiency Bonus'],
    rows,
    sourcePage: anchor.page,
  };
}

// The twelve SRD base-class names, used to anchor the Multiclassing and
// (indirectly) language rows. Case-sensitive so a lowercase continuation line
// ("class’s skill list") can never be mistaken for a new row.
const MULTICLASS_CLASS_NAME =
  'Barbarian|Bard|Cleric|Druid|Fighter|Monk|Paladin|Ranger|Rogue|Sorcerer|Warlock|Wizard';

// Multiclassing Prerequisites: one single-line row per class, the ability-score
// minimum (which itself may contain spaces, e.g. "Strength 13 or Dexterity 13")
// as the remainder.
const MULTICLASS_PREREQUISITES_ANCHOR = /^Multiclassing Prerequisites$/i;
const MULTICLASS_PREREQUISITES_ROW = new RegExp(
  `^(${MULTICLASS_CLASS_NAME})\\s+(.+)$`,
);

function parseMulticlassPrerequisiteRow(
  line: string,
): readonly [string, string] | undefined {
  const match = MULTICLASS_PREREQUISITES_ROW.exec(line);
  if (match === null) return undefined;
  return [match[1], normalizeWhitespace(match[2])];
}

function parseMulticlassPrerequisites(
  flat: readonly FlatLine[],
): TableExtraction | undefined {
  const anchor = findAnchor(flat, MULTICLASS_PREREQUISITES_ANCHOR);
  if (anchor === undefined) return undefined;
  const rows = collectRows(
    flat,
    anchor.idx + 1,
    parseMulticlassPrerequisiteRow,
  );
  if (rows.length !== 12) return undefined;
  return {
    name: 'Multiclassing Prerequisites',
    columns: ['Class', 'Ability Score Minimum'],
    rows,
    sourcePage: anchor.page,
  };
}

// Multiclassing Proficiencies: one row per class, but the proficiency cell
// wraps across multiple extracted lines (the same shape as the Madness tables).
// A row starts at a class-name prefix; every following line that does not start
// with a class name continues the current cell. The "—" cells (Sorcerer,
// Wizard) are single-line rows. The table ends at the "Class Features" heading.
const MULTICLASS_PROFICIENCIES_ANCHOR = /^Multiclassing Proficiencies$/i;
const MULTICLASS_PROFICIENCIES_HEADER = /^Class Proficiencies Gained$/i;
const MULTICLASS_PROFICIENCIES_END = /^Class Features$/i;
const MULTICLASS_PROFICIENCIES_ROW_START = new RegExp(
  `^(${MULTICLASS_CLASS_NAME})\\s+(.+)$`,
);

function parseMulticlassProficiencies(
  flat: readonly FlatLine[],
): TableExtraction | undefined {
  const anchor = findAnchor(flat, MULTICLASS_PROFICIENCIES_ANCHOR);
  if (anchor === undefined) return undefined;

  const rows: [string, string][] = [];
  let currentClass: string | undefined;
  let currentText: string[] = [];
  const flush = (): void => {
    if (currentClass === undefined) return;
    rows.push([currentClass, joinWrappedCell(currentText)]);
    currentClass = undefined;
    currentText = [];
  };

  const end = Math.min(flat.length, anchor.idx + MAX_TABLE_SCAN_LINES);
  for (let i = anchor.idx + 1; i < end; i++) {
    const line = flat[i].line.trim();
    if (line.length === 0 || MULTICLASS_PROFICIENCIES_HEADER.test(line)) {
      continue;
    }
    if (MULTICLASS_PROFICIENCIES_END.test(line)) {
      break;
    }
    const rowStart = MULTICLASS_PROFICIENCIES_ROW_START.exec(line);
    if (rowStart !== null) {
      flush();
      currentClass = rowStart[1];
      currentText = [rowStart[2]];
      continue;
    }
    if (currentClass !== undefined) {
      currentText.push(line);
    }
  }
  flush();

  if (rows.length !== 12) return undefined;
  return {
    name: 'Multiclassing Proficiencies',
    columns: ['Class', 'Proficiencies Gained'],
    rows,
    sourcePage: anchor.page,
  };
}

// Standard / Exotic Languages: three-column language / speakers / script rows.
// The middle "Typical Speakers" cell can contain spaces ("Dragons, dragonborn",
// "Underworld traders") and the language name itself can be two words ("Deep
// Speech"), so neither boundary can be found by token position alone. Each
// table's language names are a fixed reviewed set; the row is split by matching
// the longest known language prefix, taking the final token as the single-word
// script, and treating everything between as the speakers cell.
const LANGUAGE_TABLE_HEADER = /^Language Typical Speakers Script$/i;
const STANDARD_LANGUAGE_NAMES: readonly string[] = [
  'Common',
  'Dwarvish',
  'Elvish',
  'Giant',
  'Gnomish',
  'Goblin',
  'Halfling',
  'Orc',
];
const EXOTIC_LANGUAGE_NAMES: readonly string[] = [
  'Abyssal',
  'Celestial',
  'Draconic',
  'Deep Speech',
  'Infernal',
  'Primordial',
  'Sylvan',
  'Undercommon',
];

function parseLanguageTable(
  flat: readonly FlatLine[],
  input: {
    readonly anchorPattern: RegExp;
    readonly name: string;
    readonly languages: readonly string[];
  },
): TableExtraction | undefined {
  const anchor = findAnchor(flat, input.anchorPattern);
  if (anchor === undefined) return undefined;
  // Longest names first so "Deep Speech" wins over any shorter prefix.
  const sorted = [...input.languages].sort((a, b) => b.length - a.length);
  const rows: [string, string, string][] = [];
  const end = Math.min(flat.length, anchor.idx + MAX_TABLE_SCAN_LINES);
  for (let i = anchor.idx + 1; i < end; i++) {
    const line = flat[i].line.trim();
    if (line.length === 0 || LANGUAGE_TABLE_HEADER.test(line)) {
      continue;
    }
    const language = sorted.find(
      (name) => line === name || line.startsWith(`${name} `),
    );
    if (language === undefined) {
      if (rows.length > 0) break;
      continue;
    }
    const rest = normalizeWhitespace(line.slice(language.length));
    const tokens = rest.split(' ');
    const script = tokens[tokens.length - 1] ?? '';
    const speakers = tokens.slice(0, -1).join(' ');
    rows.push([language, speakers, script]);
  }
  if (rows.length !== input.languages.length) return undefined;
  return {
    name: input.name,
    columns: ['Language', 'Typical Speakers', 'Script'],
    rows,
    sourcePage: anchor.page,
  };
}

// Multiclass Spellcaster: Spell Slots per Spell Level (p58, eshyra-0m9.18):
// the combined spell-slot progression for multiclassed spellcasters. The
// caption renders as two lines ("Multiclass Spellcaster:" then "Spell Slots
// per Spell Level"); the first line — with its trailing colon — is unique in
// the fed slices, so it anchors the table (the body-prose mention "consulting
// the Multiclass Spellcaster table." cannot match the `:$` anchor). Each of
// the 20 rows survives extraction as one space-separated line: an ordinal
// caster-level cell ("1st" … "20th") followed by exactly nine slot cells.
// Numeric slot counts emit as integers; the "no slots at this level" em-dash
// cells are preserved verbatim, like the Sorcerer/Wizard "—" proficiency
// cells above.
const MULTICLASS_SPELL_SLOTS_ANCHOR = /^Multiclass Spellcaster:$/;
const MULTICLASS_SPELL_SLOTS_ROW =
  /^(\d{1,2}(?:st|nd|rd|th))((?:\s+(?:\d+|[—–-])){9})$/;

function parseMulticlassSpellSlotRow(
  line: string,
): readonly (string | number)[] | undefined {
  const match = MULTICLASS_SPELL_SLOTS_ROW.exec(line);
  if (match === null) return undefined;
  const slots = normalizeWhitespace(match[2])
    .split(' ')
    .map((cell) => (/^\d+$/.test(cell) ? Number.parseInt(cell, 10) : cell));
  return [match[1], ...slots];
}

function parseMulticlassSpellSlots(
  flat: readonly FlatLine[],
): TableExtraction | undefined {
  const anchor = findAnchor(flat, MULTICLASS_SPELL_SLOTS_ANCHOR);
  if (anchor === undefined) return undefined;
  const rows = collectRows(flat, anchor.idx + 1, parseMulticlassSpellSlotRow);
  // The progression is exactly 20 caster levels; a short parse means the
  // extraction drifted, so fail this table rather than emit a partial track.
  if (rows.length !== 20) return undefined;
  return {
    name: 'Multiclass Spellcaster: Spell Slots per Spell Level',
    columns: [
      'Lvl.',
      '1st',
      '2nd',
      '3rd',
      '4th',
      '5th',
      '6th',
      '7th',
      '8th',
      '9th',
    ],
    rows,
    sourcePage: anchor.page,
  };
}

// --- Equipment / Expenses cost tables (p62, p72-74, eshyra-0m9.19) -----------
//
// These money / downtime tables live in the Equipment chapter (Standard
// Exchange Rates, p62) and the "Expenses" region after it (Trade Goods,
// Lifestyle Expenses, Food/Drink/Lodging, Services; p72-74). They are anchored
// on their unique COLUMN-HEADER line rather than their title, because each
// title also appears as a section heading earlier in the same slice (e.g.
// "Trade Goods" is both the section heading and the table title); the header
// line is unique and immediately precedes the rows.

// Standard Exchange Rates (p62): the coin cross-rate matrix. Each row is
// "<Coin> (<abbr>) <CP> <SP> <EP> <GP> <PP>" with fractional cells ("1/10",
// "1/1,000") preserved verbatim as strings.
const STANDARD_EXCHANGE_RATES_HEADER = /^Coin CP SP EP GP PP$/i;
const STANDARD_EXCHANGE_RATES_ROW =
  /^((?:Copper|Silver|Electrum|Gold|Platinum) \((?:cp|sp|ep|gp|pp)\))\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/;

function parseStandardExchangeRatesRow(
  line: string,
): readonly [string, string, string, string, string, string] | undefined {
  const match = STANDARD_EXCHANGE_RATES_ROW.exec(line);
  if (match === null) return undefined;
  return [match[1], match[2], match[3], match[4], match[5], match[6]];
}

function parseStandardExchangeRates(
  flat: readonly FlatLine[],
): TableExtraction | undefined {
  const anchor = findAnchor(flat, STANDARD_EXCHANGE_RATES_HEADER);
  if (anchor === undefined) return undefined;
  const rows = collectRows(flat, anchor.idx + 1, parseStandardExchangeRatesRow);
  if (rows.length !== 5) return undefined;
  return {
    name: 'Standard Exchange Rates',
    columns: ['Coin', 'CP', 'SP', 'EP', 'GP', 'PP'],
    rows,
    sourcePage: anchor.page,
  };
}

// Trade Goods (p72): "<cost> <goods>" where the cost is a leading
// number+denomination ("1 cp", "500 gp") and the goods description is the rest.
const TRADE_GOODS_HEADER = /^Cost Goods$/i;
const TRADE_GOODS_ROW = /^(\d+ (?:cp|sp|ep|gp|pp)) (.+)$/;

function parseTradeGoodsRow(
  line: string,
): readonly [string, string] | undefined {
  const match = TRADE_GOODS_ROW.exec(line);
  if (match === null) return undefined;
  return [match[1], normalizeWhitespace(match[2])];
}

function parseTradeGoods(
  flat: readonly FlatLine[],
): TableExtraction | undefined {
  const anchor = findAnchor(flat, TRADE_GOODS_HEADER);
  if (anchor === undefined) return undefined;
  const rows = collectRows(flat, anchor.idx + 1, parseTradeGoodsRow);
  if (rows.length !== 13) return undefined;
  return {
    name: 'Trade Goods',
    columns: ['Cost', 'Goods'],
    rows,
    sourcePage: anchor.page,
  };
}

// Lifestyle Expenses (p72-73): one row per named lifestyle; the value cell may
// be "—" (Wretched) or carry a trailing qualifier ("10 gp minimum"), so the
// row is anchored on the known lifestyle name and the remainder is the value.
const LIFESTYLE_EXPENSES_HEADER = /^Lifestyle Price\/Day$/i;
const LIFESTYLE_EXPENSES_ROW =
  /^(Wretched|Squalid|Poor|Modest|Comfortable|Wealthy|Aristocratic)\s+(.+)$/;

function parseLifestyleExpensesRow(
  line: string,
): readonly [string, string] | undefined {
  const match = LIFESTYLE_EXPENSES_ROW.exec(line);
  if (match === null) return undefined;
  return [match[1], normalizeWhitespace(match[2])];
}

function parseLifestyleExpenses(
  flat: readonly FlatLine[],
): TableExtraction | undefined {
  const anchor = findAnchor(flat, LIFESTYLE_EXPENSES_HEADER);
  if (anchor === undefined) return undefined;
  const rows = collectRows(flat, anchor.idx + 1, parseLifestyleExpensesRow);
  if (rows.length !== 7) return undefined;
  return {
    name: 'Lifestyle Expenses',
    columns: ['Lifestyle', 'Price/Day'],
    rows,
    sourcePage: anchor.page,
  };
}

// Grouped cost tables (Food/Drink/Lodging p73-74, Services p74). The SRD prints
// these with sub-heading rows ("Ale", "Coach cab") above indented sub-item rows
// ("Gallon 2 sp"), plus some ungrouped top-level items ("Bread, loaf 2 cp").
// PDF extraction loses the indentation, so the grouping is supplied as a
// reviewed structure (eshyra-0m9.19): the group-header set and each group's
// member-name set. Sub-items fold into a qualified, query-friendly item name —
// "Inn stay (per day)" + "Squalid" -> "Inn stay, squalid (per day)" — so every
// emitted row is a standalone purchasable line (no value-less heading rows). The
// CELL VALUES still come from extraction; only the row classification is
// reviewed. A value-less line that is NOT a known group header bounds the table
// (the trailing prose paragraph after Services, or the "Services" heading after
// Food/Drink/Lodging).
const GROUPED_COST_VALUE =
  /^(.*?)\s+(\d+\s+(?:cp|sp|ep|gp|pp)(?:\s+per\s+\w+)?)$/;

interface GroupedCostTableSpec {
  readonly headerAnchor: RegExp;
  readonly name: string;
  readonly columns: readonly [string, string];
  /** Group header -> ordered member sub-item names (verbatim, pre-fold). */
  readonly groups: ReadonlyMap<string, readonly string[]>;
  readonly expectedRows: number;
}

// Fold "Inn stay (per day)" + "Squalid" -> "Inn stay, squalid (per day)":
// the group header's trailing parenthetical (if any) moves to the end and the
// sub-item is lower-cased, matching the reviewed naming convention.
function foldGroupedItemName(header: string, subItem: string): string {
  const parenMatch = /^(.*?)\s*(\([^)]*\))\s*$/.exec(header);
  const base = parenMatch === null ? header : parenMatch[1].trim();
  const parenthetical = parenMatch === null ? '' : parenMatch[2];
  const lowered = subItem.charAt(0).toLowerCase() + subItem.slice(1);
  return `${base}, ${lowered}${parenthetical === '' ? '' : ` ${parenthetical}`}`;
}

function parseGroupedCostTable(
  flat: readonly FlatLine[],
  spec: GroupedCostTableSpec,
): TableExtraction | undefined {
  const anchor = findAnchor(flat, spec.headerAnchor);
  if (anchor === undefined) return undefined;

  const memberOf = (header: string, name: string): boolean =>
    spec.groups.get(header)?.includes(name) ?? false;

  const rows: [string, string][] = [];
  let currentHeader: string | undefined;
  const end = Math.min(flat.length, anchor.idx + MAX_TABLE_SCAN_LINES);
  for (let i = anchor.idx + 1; i < end; i++) {
    const line = flat[i].line.trim();
    if (line.length === 0) continue;
    const priced = GROUPED_COST_VALUE.exec(line);
    if (priced === null) {
      // A value-less line is either a known group header or the table boundary.
      if (spec.groups.has(line)) {
        currentHeader = line;
        continue;
      }
      break;
    }
    const name = normalizeWhitespace(priced[1]);
    const value = normalizeWhitespace(priced[2]);
    if (currentHeader !== undefined && memberOf(currentHeader, name)) {
      rows.push([foldGroupedItemName(currentHeader, name), value]);
    } else {
      // Ungrouped top-level item — closes any open group.
      currentHeader = undefined;
      rows.push([name, value]);
    }
  }

  if (rows.length !== spec.expectedRows) return undefined;
  return {
    name: spec.name,
    columns: [spec.columns[0], spec.columns[1]],
    rows,
    sourcePage: anchor.page,
  };
}

const LIFESTYLE_TIERS: readonly string[] = [
  'Squalid',
  'Poor',
  'Modest',
  'Comfortable',
  'Wealthy',
  'Aristocratic',
];

const FOOD_DRINK_LODGING_SPEC: GroupedCostTableSpec = {
  headerAnchor: /^Item Cost$/i,
  name: 'Food, Drink, and Lodging',
  columns: ['Item', 'Cost'],
  groups: new Map<string, readonly string[]>([
    ['Ale', ['Gallon', 'Mug']],
    ['Inn stay (per day)', LIFESTYLE_TIERS],
    ['Meals (per day)', LIFESTYLE_TIERS],
    ['Wine', ['Common (pitcher)', 'Fine (bottle)']],
  ]),
  // 8 grouped (Ale 2 + Wine 2) + 12 (Inn stay 6 + Meals 6) + 4 ungrouped
  // (Banquet, Bread, Cheese, Meat) = 20 priced rows.
  expectedRows: 20,
};

const SERVICES_SPEC: GroupedCostTableSpec = {
  headerAnchor: /^Service Pay$/i,
  name: 'Services',
  columns: ['Service', 'Pay'],
  groups: new Map<string, readonly string[]>([
    ['Coach cab', ['Between towns', 'Within a city']],
    ['Hireling', ['Skilled', 'Untrained']],
  ]),
  // 4 grouped (Coach cab 2 + Hireling 2) + 3 ungrouped (Messenger, Road or gate
  // toll, Ship's passage) = 7 rows.
  expectedRows: 7,
};

// The four Monsters-chapter reference tables live in the chapter's
// stat-block-rules region (pp254-258), fed into `parseTables` via the
// `monsterRulePages` sub-slice (eshyra-0m9.22).
//
// Size Categories (p254) shares its caption with the core-rules Combat
// chapter's two-column Size/Space table (p92), and both captions are present
// in the concatenated input, so this parser anchors on the Monsters version's
// unique header row ("Size Space Examples") rather than on the ambiguous
// caption. Each row carries a size word, a space cell ("2½ by 2½ ft.", with
// the Gargantuan "or larger" suffix), and a verbatim examples cell.
const SIZE_CATEGORIES_HEADER = /^Size Space Examples$/i;
const SIZE_CATEGORIES_ROW =
  /^(Tiny|Small|Medium|Large|Huge|Gargantuan)\s+(.+?\bft\.(?: or larger)?)\s+(.+)$/;

function parseSizeCategoriesRow(
  line: string,
): readonly [string, string, string] | undefined {
  const match = SIZE_CATEGORIES_ROW.exec(line);
  if (match === null) return undefined;
  return [match[1], match[2], match[3]];
}

function parseSizeCategories(
  flat: readonly FlatLine[],
): TableExtraction | undefined {
  const anchor = findAnchor(flat, SIZE_CATEGORIES_HEADER);
  if (anchor === undefined) return undefined;
  const rows = collectRows(flat, anchor.idx + 1, parseSizeCategoriesRow);
  if (rows.length === 0) return undefined;
  return {
    name: 'Size Categories',
    columns: ['Size', 'Space', 'Examples'],
    rows,
    sourcePage: anchor.page,
  };
}

// Hit Dice by Size (p256): size word, hit die, and the verbatim half-point
// average ("2½" … "10½").
const HIT_DICE_BY_SIZE_ANCHOR = /^Hit Dice by Size$/i;
const HIT_DICE_BY_SIZE_ROW =
  /^(Tiny|Small|Medium|Large|Huge|Gargantuan)\s+(d\d+)\s+(\d+½)$/;

function parseHitDiceBySizeRow(
  line: string,
): readonly [string, string, string] | undefined {
  const match = HIT_DICE_BY_SIZE_ROW.exec(line);
  if (match === null) return undefined;
  return [match[1], match[2], match[3]];
}

function parseHitDiceBySize(
  flat: readonly FlatLine[],
): TableExtraction | undefined {
  const anchor = findAnchor(flat, HIT_DICE_BY_SIZE_ANCHOR);
  if (anchor === undefined) return undefined;
  const rows = collectRows(flat, anchor.idx + 1, parseHitDiceBySizeRow);
  if (rows.length === 0) return undefined;
  return {
    name: 'Hit Dice by Size',
    columns: ['Monster Size', 'Hit Die', 'Average HP per Die'],
    rows,
    sourcePage: anchor.page,
  };
}

// Proficiency Bonus by Challenge Rating (p256) and Experience Points by
// Challenge Rating (p258) print as PAIRED columns: each physical line carries
// two logical rows side by side ("1/8 +2 15 +5"; "1/8 25 15 13,000"), with the
// low challenge ratings in the left pair and the high ones in the right pair.
// A four-group row regex splits each physical line; the table is rebuilt by
// emitting every left pair in document order followed by every right pair, so
// the logical rows run CR 0 → 30 top to bottom. Challenge ratings ("1/8") and
// XP values ("11,500", and the CR 0 special case "0 or 10") are preserved as
// verbatim cell text.
interface PairedColumnSpec {
  readonly anchorPattern: RegExp;
  readonly name: string;
  readonly columns: readonly [string, string];
  readonly rowPattern: RegExp;
}

const PROFICIENCY_BONUS_BY_CR_SPEC: PairedColumnSpec = {
  anchorPattern: /^Proficiency Bonus by Challenge Rating$/i,
  name: 'Proficiency Bonus by Challenge Rating',
  columns: ['Challenge', 'Proficiency Bonus'],
  rowPattern: /^(\d+(?:\/\d+)?)\s+(\+\d+)\s+(\d+)\s+(\+\d+)$/,
};

const XP_BY_CR_SPEC: PairedColumnSpec = {
  anchorPattern: /^Experience Points by Challenge Rating$/i,
  name: 'Experience Points by Challenge Rating',
  columns: ['Challenge', 'XP'],
  // The CR 0 row's left XP cell is the prose "0 or 10" (0 XP without
  // effective attacks, 10 XP with); the alternation must try it before the
  // generic numeric cell so the right pair still anchors correctly.
  rowPattern: /^(\d+(?:\/\d+)?)\s+(0 or 10|[\d,]+)\s+(\d+)\s+([\d,]+)$/,
};

function parsePairedColumnTable(
  flat: readonly FlatLine[],
  spec: PairedColumnSpec,
): TableExtraction | undefined {
  const anchor = findAnchor(flat, spec.anchorPattern);
  if (anchor === undefined) return undefined;
  const parseRow = (
    line: string,
  ): readonly [string, string, string, string] | undefined => {
    const match = spec.rowPattern.exec(line);
    if (match === null) return undefined;
    return [match[1], match[2], match[3], match[4]];
  };
  const paired = collectRows(flat, anchor.idx + 1, parseRow);
  if (paired.length === 0) return undefined;
  const rows = [
    ...paired.map((pair) => [pair[0], pair[1]]),
    ...paired.map((pair) => [pair[2], pair[3]]),
  ];
  return {
    name: spec.name,
    columns: spec.columns,
    rows,
    sourcePage: anchor.page,
  };
}

export function parseTables(pages: readonly PageText[]): TableExtraction[] {
  const flat = flatten(pages);
  const tables = [
    parseDifficultyClasses(flat),
    parseTrapSaveDcs(flat),
    parseDamageSeverity(flat),
    parseMadnessTable(flat, {
      anchorPattern: /^Short-Term Madness$/i,
      name: 'Short-Term Madness',
      valueColumn: 'Effect',
      expectedRows: 10,
    }),
    parseMadnessTable(flat, {
      anchorPattern: /^Long-Term Madness$/i,
      name: 'Long-Term Madness',
      valueColumn: 'Effect',
      expectedRows: 12,
    }),
    parseMadnessTable(flat, {
      anchorPattern: /^Indefinite Madness$/i,
      name: 'Indefinite Madness',
      valueColumn: 'Flaw',
      expectedRows: 12,
    }),
    parseObjectArmorClass(flat),
    parseObjectHitPoints(flat),
    parseXpThresholds(flat),
    parseCharacterAdvancement(flat),
    parseMulticlassPrerequisites(flat),
    parseMulticlassProficiencies(flat),
    parseLanguageTable(flat, {
      anchorPattern: /^Standard Languages$/i,
      name: 'Standard Languages',
      languages: STANDARD_LANGUAGE_NAMES,
    }),
    parseLanguageTable(flat, {
      anchorPattern: /^Exotic Languages$/i,
      name: 'Exotic Languages',
      languages: EXOTIC_LANGUAGE_NAMES,
    }),
    parseMulticlassSpellSlots(flat),
    parseStandardExchangeRates(flat),
    parseTradeGoods(flat),
    parseLifestyleExpenses(flat),
    parseGroupedCostTable(flat, FOOD_DRINK_LODGING_SPEC),
    parseGroupedCostTable(flat, SERVICES_SPEC),
    parseSizeCategories(flat),
    parseHitDiceBySize(flat),
    parsePairedColumnTable(flat, PROFICIENCY_BONUS_BY_CR_SPEC),
    parsePairedColumnTable(flat, XP_BY_CR_SPEC),
    ...parseTreasureTables(flat),
  ].filter((table): table is TableExtraction => table !== undefined);
  tables.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return tables;
}
