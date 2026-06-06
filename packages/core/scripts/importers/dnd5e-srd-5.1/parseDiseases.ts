/**
 * Sample-disease parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` already narrowed to the gamemastering
 * "Diseases" section (see the `diseases` anchor in `sections.ts`); output is a
 * `DiseaseExtraction[]` with stable shape, sorted by name.
 *
 * The SRD's "Diseases" section opens with general disease-running guidance
 * (the "plague as plot device" framing) and a "Sample Diseases" caption, then
 * three named sample diseases (Cackle Fever, Sewer Plague, Sight Rot). Each
 * disease is introduced by its exact name on its own line (rendered a font tier
 * above the body but below the section-anchor threshold). This parser extracts
 * only the three SAMPLE DISEASES, identified by an exact match against the known
 * SRD 5.1 disease names — mirroring `parseHazards`. Lines before the first match
 * (the general guidance prose and the "Sample Diseases" caption) and any line
 * that is not a known disease name are body text. The general guidance prose is
 * intentionally not emitted (DM-facing framing, not a lookupable game entity);
 * only the three named diseases become records.
 *
 * Sample diseases use plain prose paragraphs (no bullet-point effects), so the
 * body parser re-flows wrapped lines into paragraph-separated text, mirroring
 * `parseHazards` / `parseTraps`.
 *
 * Diseases emit under the `hazard` record kind with `data.category: 'disease'`
 * (see `diseaseExtractionsToRecords` and the importer README): like traps, a
 * disease is a description-only danger with a save DC and effects, so it
 * satisfies the same `hazard` kindSchema without minting a new exhaustive kind.
 */

import type { DiseaseExtraction, PageText } from './types.js';

export const DISEASE_NAMES = [
  'Cackle Fever',
  'Sewer Plague',
  'Sight Rot',
] as const;

export type DiseaseName = (typeof DISEASE_NAMES)[number];

const DISEASE_NAME_SET = new Set<string>(DISEASE_NAMES);

function isDiseaseName(line: string): line is DiseaseName {
  return DISEASE_NAME_SET.has(line.trim());
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

interface DiseaseEntry {
  readonly nameIdx: number;
  readonly name: DiseaseName;
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
 * Parse sample-disease entries from the narrowed "Diseases" section
 * `PageText[]`. Returns a `DiseaseExtraction[]` sorted by name. Leading guidance
 * prose and the "Sample Diseases" caption before the first known disease name
 * are skipped — a disease is recognized only by its exact name line.
 */
export function parseDiseases(pages: readonly PageText[]): DiseaseExtraction[] {
  const flat = flatten(pages);

  const entries: DiseaseEntry[] = [];
  for (let i = 0; i < flat.length; i++) {
    const line = flat[i].line.trim();
    if (isDiseaseName(line)) {
      entries.push({ nameIdx: i, name: line as DiseaseName });
    }
  }

  if (entries.length === 0) return [];

  const out: DiseaseExtraction[] = [];
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
