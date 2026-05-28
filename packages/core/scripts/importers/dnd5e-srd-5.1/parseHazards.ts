/**
 * Hazard-entry parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` already narrowed to the hazards section of
 * the SRD (e.g. "Dungeon Hazards"); output is a `HazardExtraction[]` with
 * stable shape, sorted by name.
 *
 * Each hazard is identified by an exact match against the 4 known SRD 5.1
 * hazard names. Lines preceding the first match and any lines that don't fit
 * the known-name set are silently skipped — safe because the caller is
 * responsible for narrowing the input to the hazards section via `sliceSection`.
 *
 * SRD 5.1 hazards use plain prose paragraphs (no bullet-point effects), so
 * the body parser simply re-flows wrapped lines into paragraph-separated text.
 */

import type { HazardExtraction, PageText } from './types.js';

export const HAZARD_NAMES = [
  'Brown Mold',
  'Green Slime',
  'Webs',
  'Yellow Mold',
] as const;

export type HazardName = (typeof HAZARD_NAMES)[number];

const HAZARD_NAME_SET = new Set<string>(HAZARD_NAMES);

function isHazardName(line: string): line is HazardName {
  return HAZARD_NAME_SET.has(line.trim());
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

interface HazardEntry {
  readonly nameIdx: number;
  readonly name: HazardName;
}

/** Re-flow wrapped body lines into paragraph-separated prose. */
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
    current.push(line);
  }
  if (current.length > 0) {
    paragraphs.push(current.join(' '));
  }
  return paragraphs.join('\n\n').trim();
}

/**
 * Parse hazard entries from the narrowed hazards-section `PageText[]`.
 * Returns a `HazardExtraction[]` sorted by name.
 */
export function parseHazards(pages: readonly PageText[]): HazardExtraction[] {
  const flat = flatten(pages);

  const entries: HazardEntry[] = [];
  for (let i = 0; i < flat.length; i++) {
    const line = flat[i].line.trim();
    if (isHazardName(line)) {
      entries.push({ nameIdx: i, name: line as HazardName });
    }
  }

  if (entries.length === 0) return [];

  const out: HazardExtraction[] = [];
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
