/**
 * Reference-table parser for the D&D 5e SRD 5.1 importer.
 *
 * PDF text extraction does not preserve table semantics, so this parser stays
 * deliberately narrow: row-regex reconstruction for the simple reference
 * tables and column-block reconstruction for the treasure challenge tables.
 *
 * Eight tables are present in the vendored SRD 5.1 PDF: Difficulty Classes,
 * two trap tables, three Madness effect tables, and the Object Armor Class /
 * Object Hit Points tables. XP-threshold and treasure-table reconstruction
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
    ...parseTreasureTables(flat),
  ].filter((table): table is TableExtraction => table !== undefined);
  tables.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return tables;
}
