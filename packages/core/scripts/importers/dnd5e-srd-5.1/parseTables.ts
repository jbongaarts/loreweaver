/**
 * Reference-table parser for the D&D 5e SRD 5.1 importer.
 *
 * PDF text extraction does not preserve table semantics, so this parser uses
 * deliberately narrow per-table anchors plus row reconstruction heuristics for
 * the freestanding tables covered today. Some SRD treasure tables are emitted
 * as interleaved column blocks, so those use a separate column-block
 * reconstruction pass.
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
    if (TREASURE_TABLE_ANCHOR.test(line)) {
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
    parseXpThresholds(flat),
    ...parseTreasureTables(flat),
  ].filter((table): table is TableExtraction => table !== undefined);
  tables.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return tables;
}
