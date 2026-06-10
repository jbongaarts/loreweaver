/**
 * Background parser for the D&D 5e SRD 5.1 importer (eshyra-0m9.17).
 *
 * Input is a slice of `PageText[]` already narrowed to the SRD "Backgrounds"
 * chapter (p60-61: the chapter intro sections followed by the lone Acolyte
 * entry). Output is the parsed background entries plus the four
 * suggested-characteristics roll tables each entry carries (d8 Personality
 * Trait, d6 Ideal, d6 Bond, d6 Flaw), which emit under the `table` kind.
 *
 * Entry shape in the source:
 *   - an entry heading at the sub-subsection font tier (h≈13.9: "Acolyte");
 *   - intro/flavor prose;
 *   - the labeled grant lines ("Skill Proficiencies: …", optionally
 *     "Tool Proficiencies: …", "Languages: …", "Equipment: …"), each wrapping
 *     over continuation lines at body font;
 *   - a "Feature: <Name>" leaf heading (h≈12) and the feature body;
 *   - a "Suggested Characteristics" leaf heading (h≈12), its intro prose, and
 *     the four roll tables at table font (h≈8.9), each headed "d8 <Label>" /
 *     "d6 <Label>" with ascending numbered rows whose text wraps.
 *
 * Entry detection runs in two modes, mirroring `parseRules`:
 *   - heading-hierarchy mode (real SRD extraction with `lineHeights`): an
 *     entry heading is a line at the sub-subsection tier (13 ≤ h < 16);
 *   - text-heuristic mode (uniform-font fixture PDFs): an entry heading is a
 *     short heading-cased line.
 * In BOTH modes a candidate only counts as a background entry when a
 * "Skill Proficiencies:" line follows it before the next candidate — every SRD
 * background opens its grant block with that label, and no chapter-intro
 * section does, so intro headings ("Proficiencies", "Customizing a
 * Background") are never promoted to entries.
 *
 * Roll-table names are synthesized as "<Background> <Label>s" (e.g. "Acolyte
 * Personality Traits") because the SRD prints the tables caption-less — the
 * die header ("d8 Personality Trait") is the only title text, and a bare
 * "Personality Trait" key would collide across backgrounds in any source with
 * more than one. The column headers keep the verbatim source text.
 */

import type {
  BackgroundExtraction,
  PageText,
  TableExtraction,
} from './types.js';

interface FlatLine {
  readonly line: string;
  readonly page: number;
  readonly height?: number;
}

function flatten(pages: readonly PageText[]): FlatLine[] {
  const out: FlatLine[] = [];
  for (const page of pages) {
    const heights = page.lineHeights;
    for (let i = 0; i < page.lines.length; i++) {
      out.push({
        line: page.lines[i].trim(),
        page: page.pageNumber,
        height: heights?.[i],
      });
    }
  }
  return out;
}

/**
 * Sub-subsection tier band (h≈13.9) the SRD renders background entry headings
 * at — the same tier as the Traps section's "Sample Traps" heading. Bounds
 * mirror `parseRules`' `SUBSUB_MIN_H` / `SUB_MIN_H`.
 */
const ENTRY_HEADING_MIN_H = 13;
const ENTRY_HEADING_MAX_H = 16;

const LABELED_LINE =
  /^(Skill Proficiencies|Tool Proficiencies|Languages|Equipment):\s*(.*)$/;
const SKILL_PROFICIENCIES_LINE = /^Skill Proficiencies:/;
const FEATURE_HEADING = /^Feature:\s*(.+)$/;
const SUGGESTED_CHARACTERISTICS_HEADING = /^Suggested Characteristics$/;
const ROLL_TABLE_HEADER = /^d(\d+)\s+(.+)$/;
const NUMBERED_ROW = /^(\d+)\s+(.+)$/;

const CONNECTOR_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

function isHeadingCase(line: string): boolean {
  const tokens = line
    .split(/\s+/)
    .map((t) => t.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ''))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return false;
  let hasCapitalizedContent = false;
  for (const token of tokens) {
    if (CONNECTOR_WORDS.has(token.toLowerCase())) continue;
    if (/^[A-Z][A-Za-z0-9'’/-]*$/.test(token)) {
      hasCapitalizedContent = true;
      continue;
    }
    return false;
  }
  return hasCapitalizedContent;
}

/** Re-flow wrapped body lines into paragraph-separated prose. */
function joinParagraphs(lines: readonly string[]): string {
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.length === 0) {
      if (current.length > 0) {
        paragraphs.push(current.join(' '));
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) {
    paragraphs.push(current.join(' '));
  }
  return paragraphs.join('\n\n').trim();
}

function isEntryHeadingCandidate(
  flat: readonly FlatLine[],
  idx: number,
  useHeights: boolean,
): boolean {
  const { line, height } = flat[idx];
  if (line.length === 0 || line.length > 60) return false;
  if (LABELED_LINE.test(line) || FEATURE_HEADING.test(line)) return false;
  if (useHeights) {
    return (
      height !== undefined &&
      height >= ENTRY_HEADING_MIN_H &&
      height < ENTRY_HEADING_MAX_H
    );
  }
  return isHeadingCase(line);
}

export interface ParseBackgroundsResult {
  readonly backgrounds: readonly BackgroundExtraction[];
  /**
   * The suggested-characteristics roll tables, one `table` record each, with
   * names synthesized as "<Background> <Label>s" (the SRD prints these tables
   * caption-less; see module doc).
   */
  readonly characteristicTables: readonly TableExtraction[];
}

export function parseBackgrounds(
  pages: readonly PageText[],
): ParseBackgroundsResult {
  const flat = flatten(pages);
  if (flat.length === 0) return { backgrounds: [], characteristicTables: [] };

  // Same tier-availability test as parseRules: only trust font heights when
  // the slice carries a genuine multi-tier structure. Uniform-font fixture
  // PDFs fall back to the heading-case heuristic.
  const definedHeights = flat
    .map((f) => f.height)
    .filter((h): h is number => h !== undefined);
  const useHeights =
    new Set(definedHeights).size > 1 &&
    definedHeights.some((h) => h >= ENTRY_HEADING_MIN_H);

  const candidateIdxs: number[] = [];
  for (let i = 0; i < flat.length; i++) {
    if (isEntryHeadingCandidate(flat, i, useHeights)) candidateIdxs.push(i);
  }

  // A candidate is a background entry only when its section (up to the next
  // candidate) opens a grant block with "Skill Proficiencies:".
  const entryIdxs: number[] = [];
  for (let c = 0; c < candidateIdxs.length; c++) {
    const start = candidateIdxs[c];
    const end = candidateIdxs[c + 1] ?? flat.length;
    let hasSkillProficiencies = false;
    for (let i = start + 1; i < end; i++) {
      if (SKILL_PROFICIENCIES_LINE.test(flat[i].line)) {
        hasSkillProficiencies = true;
        break;
      }
    }
    if (hasSkillProficiencies) entryIdxs.push(start);
  }

  const backgrounds: BackgroundExtraction[] = [];
  const characteristicTables: TableExtraction[] = [];
  for (let e = 0; e < entryIdxs.length; e++) {
    const start = entryIdxs[e];
    const end = entryIdxs[e + 1] ?? flat.length;
    const parsed = parseEntry(flat, start, end);
    if (parsed === undefined) continue;
    backgrounds.push(parsed.background);
    characteristicTables.push(...parsed.tables);
  }

  backgrounds.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  characteristicTables.sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  return { backgrounds, characteristicTables };
}

interface ParsedEntry {
  readonly background: BackgroundExtraction;
  readonly tables: readonly TableExtraction[];
}

function parseEntry(
  flat: readonly FlatLine[],
  start: number,
  end: number,
): ParsedEntry | undefined {
  const name = flat[start].line;
  const sourcePage = flat[start].page;
  let i = start + 1;

  // Intro/flavor prose runs until the first labeled grant line.
  const descriptionLines: string[] = [];
  while (i < end && !LABELED_LINE.test(flat[i].line)) {
    descriptionLines.push(flat[i].line);
    i++;
  }

  // Labeled grant block: each label's value wraps over continuation lines
  // until the next label or the "Feature:" heading.
  const labeledValues = new Map<string, string>();
  while (i < end) {
    if (flat[i].line.length === 0) {
      i++;
      continue;
    }
    const match = LABELED_LINE.exec(flat[i].line);
    if (match === null) break;
    const label = match[1];
    const valueParts = [match[2]];
    i++;
    while (
      i < end &&
      flat[i].line.length > 0 &&
      !LABELED_LINE.test(flat[i].line) &&
      !FEATURE_HEADING.test(flat[i].line)
    ) {
      valueParts.push(flat[i].line);
      i++;
    }
    labeledValues.set(label, valueParts.join(' ').trim());
  }

  // The background feature ("Feature: Shelter of the Faithful"): required —
  // every SRD background grants one, and the dnd5e background kindSchema
  // requires it. An entry without a parseable feature heading is not emitted;
  // the real import's exact name-set coverage gate then fails closed naming
  // the missing background.
  const featureMatch = i < end ? FEATURE_HEADING.exec(flat[i].line) : null;
  if (featureMatch === null) return undefined;
  const featureName = featureMatch[1].trim();
  i++;
  const featureLines: string[] = [];
  while (
    i < end &&
    !SUGGESTED_CHARACTERISTICS_HEADING.test(flat[i].line) &&
    !ROLL_TABLE_HEADER.test(flat[i].line)
  ) {
    featureLines.push(flat[i].line);
    i++;
  }

  // Suggested Characteristics intro prose, up to the first roll-table header.
  const characteristicsLines: string[] = [];
  if (i < end && SUGGESTED_CHARACTERISTICS_HEADING.test(flat[i].line)) {
    i++;
    while (i < end && !ROLL_TABLE_HEADER.test(flat[i].line)) {
      characteristicsLines.push(flat[i].line);
      i++;
    }
  }

  const tables: TableExtraction[] = [];
  while (i < end) {
    const header = ROLL_TABLE_HEADER.exec(flat[i].line);
    if (header === null) break;
    const result = parseRollTable(flat, i, end, name, header);
    tables.push(result.table);
    i = result.nextIdx;
  }

  const skillProficiencies = splitList(
    labeledValues.get('Skill Proficiencies'),
  );
  if (skillProficiencies.length === 0) return undefined;
  const toolProficiencies = splitList(labeledValues.get('Tool Proficiencies'));
  const description = joinParagraphs(descriptionLines);
  const featureText = joinParagraphs(featureLines);
  if (description.length === 0 || featureText.length === 0) return undefined;
  const suggestedCharacteristics = joinParagraphs(characteristicsLines);

  const languages = nonEmpty(labeledValues.get('Languages'));
  const equipment = nonEmpty(labeledValues.get('Equipment'));
  const background: BackgroundExtraction = {
    name,
    description,
    skillProficiencies,
    ...(toolProficiencies.length > 0 ? { toolProficiencies } : {}),
    ...(languages === undefined ? {} : { languages }),
    ...(equipment === undefined ? {} : { equipment }),
    feature: { name: featureName, text: featureText },
    ...(suggestedCharacteristics.length > 0
      ? { suggestedCharacteristics }
      : {}),
    sourcePage,
  };
  return { background, tables };
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

function splitList(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

interface RollTableResult {
  readonly table: TableExtraction;
  readonly nextIdx: number;
}

/**
 * Parse one caption-less roll table starting at its "dN <Label>" header line.
 * Rows are strictly ascending from 1 (the SRD prints them in die order), so a
 * line is a NEW row only when its leading integer is exactly the next expected
 * number and within the die size; any other non-empty line is the previous
 * row's wrapped continuation. The table ends at the next "dN <Label>" header
 * or the end of the entry.
 */
function parseRollTable(
  flat: readonly FlatLine[],
  headerIdx: number,
  end: number,
  backgroundName: string,
  header: RegExpExecArray,
): RollTableResult {
  const dieSize = Number(header[1]);
  const label = header[2].trim();
  const sourcePage = flat[headerIdx].page;
  const rows: { num: number; text: string }[] = [];
  let expected = 1;
  let i = headerIdx + 1;
  while (i < end) {
    const line = flat[i].line;
    if (ROLL_TABLE_HEADER.test(line)) break;
    if (line.length === 0) {
      i++;
      continue;
    }
    const row = NUMBERED_ROW.exec(line);
    if (row !== null && Number(row[1]) === expected && expected <= dieSize) {
      rows.push({ num: expected, text: row[2].trim() });
      expected++;
    } else if (rows.length > 0) {
      rows[rows.length - 1].text += ` ${line}`;
    } else {
      break;
    }
    i++;
  }
  const table: TableExtraction = {
    // Synthesized lookup name (the source table is caption-less; see module
    // doc): "Acolyte Personality Traits", "Acolyte Ideals", …
    name: `${backgroundName} ${label}s`,
    columns: [`d${dieSize}`, label],
    rows: rows.map((row) => [row.num, row.text]),
    sourcePage,
  };
  return { table, nextIdx: i };
}
