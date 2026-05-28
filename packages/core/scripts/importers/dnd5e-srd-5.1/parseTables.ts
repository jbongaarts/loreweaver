/**
 * Reference-table parser for the D&D 5e SRD 5.1 importer.
 *
 * PDF text extraction does not preserve table semantics, so this parser uses
 * deliberately narrow per-table anchors plus row reconstruction heuristics for
 * the simple freestanding tables covered today.
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

export function parseTables(pages: readonly PageText[]): TableExtraction[] {
  const flat = flatten(pages);
  const tables = [parseDifficultyClasses(flat), parseXpThresholds(flat)].filter(
    (table): table is TableExtraction => table !== undefined,
  );
  tables.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return tables;
}
