/**
 * Combat-action parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` already narrowed to the "Actions in
 * Combat" section of the SRD; output is an `ActionExtraction[]` with stable
 * shape, sorted by name.
 *
 * Each standard action is identified by an exact match against the canonical
 * SRD action names. Lines before the first match and any non-matching lines
 * are skipped safely because the caller is responsible for section narrowing.
 */

import type { ActionExtraction, PageText } from './types.js';

export const STANDARD_ACTION_NAMES = [
  'Attack',
  'Cast a Spell',
  'Dash',
  'Disengage',
  'Dodge',
  'Help',
  'Hide',
  'Ready',
  'Search',
  'Use an Object',
] as const;

export type StandardActionName = (typeof STANDARD_ACTION_NAMES)[number];

const ACTION_NAME_SET = new Set<string>(STANDARD_ACTION_NAMES);

function isActionName(line: string): line is StandardActionName {
  return ACTION_NAME_SET.has(line.trim());
}

interface FlatLine {
  readonly line: string;
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

interface ActionEntry {
  readonly nameIdx: number;
  readonly name: StandardActionName;
}

function joinParagraphs(lines: readonly string[]): string {
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) {
      if (current.length > 0) {
        paragraphs.push(current.join(' '));
        current = [];
      }
      continue;
    }
    const stripped = line.replace(/^[•\-*]\s+/, '');
    current.push(stripped);
  }
  if (current.length > 0) {
    paragraphs.push(current.join(' '));
  }
  return paragraphs.join('\n\n').trim();
}

/**
 * Parse standard SRD combat actions from the narrowed actions-section
 * `PageText[]`. Returns an `ActionExtraction[]` sorted by action name.
 */
export function parseActions(pages: readonly PageText[]): ActionExtraction[] {
  const flat = flatten(pages);

  const entries: ActionEntry[] = [];
  for (let i = 0; i < flat.length; i++) {
    const line = flat[i].line.trim();
    if (isActionName(line)) {
      entries.push({ nameIdx: i, name: line as StandardActionName });
    }
  }

  if (entries.length === 0) return [];

  const out: ActionExtraction[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const bodyStart = entry.nameIdx + 1;
    const bodyEnd = entries[i + 1]?.nameIdx ?? flat.length;
    const bodyLines = flat.slice(bodyStart, bodyEnd).map((f) => f.line);
    const sourcePage = flat[entry.nameIdx].page;
    const description = joinParagraphs(bodyLines);
    out.push({
      name: entry.name,
      description: description.length > 0 ? description : entry.name,
      sourcePage,
    });
  }

  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}
