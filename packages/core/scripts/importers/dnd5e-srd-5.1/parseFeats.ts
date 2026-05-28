/**
 * Feat-entry parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` already narrowed to the feats section of
 * the SRD; output is a `FeatExtraction[]` with stable shape, sorted by name.
 *
 * Feat boundary detection uses a two-pass approach:
 *   1. Identify feat-name lines using a heuristic: a short title-case line
 *      that appears at the start of the section or after a blank line, and is
 *      not itself a "Prerequisite(s):" line or obvious body prose.
 *   2. For each identified name, collect lines up to the next feat name as the
 *      feat body, then parse out any leading "Prerequisite(s):" line and the
 *      remaining benefit text.
 *
 * The parser is deliberately conservative: it only promotes a line to a feat
 * name when the candidate passes the `isFeatName` heuristic. The caller is
 * responsible for slicing the input to the feats section (via `sliceSection`
 * in `sections.ts`).
 */

import type { FeatExtraction, PageText } from './types.js';

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

// Prerequisite(s): line in the SRD (singular or plural).
const PREREQ_RE = /^Prerequisites?:\s*(.+)$/i;

function isPrereqLine(line: string): RegExpExecArray | null {
  return PREREQ_RE.exec(line.trim());
}

/**
 * Heuristic: a feat name is a short (<= 60 chars), title-case line whose first
 * character is an uppercase letter. It must not look like a "Prerequisite:"
 * line, a bullet line, or obvious body prose (which starts with "You", "While",
 * "When", "If", "As", etc. - common benefit-text sentence starters).
 */
function isFeatName(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 60) return false;
  if (/^[•\-*]\s/.test(t)) return false;
  if (isPrereqLine(t) !== null) return false;
  if (/^[a-z]/.test(t)) return false;
  // Body-prose starters: multi-word sentences that open with common
  // English functional words found at the start of benefit paragraphs.
  if (
    /^(You|When|While|If|As |Once|The |This |These |Each |At |Your |For |To |In |By |With |Through )/.test(
      t,
    )
  ) {
    return false;
  }
  // Accept short title-case lines: letters, digits, spaces, hyphens,
  // apostrophes, slashes, and parens (covers names like "War Caster",
  // "Dual Wielder", "Athlete", "Elemental Adept (PHB p.166)").
  return /^[A-Z][A-Za-z0-9 ,'\-:/()]+$/.test(t);
}

interface FeatEntry {
  readonly nameIdx: number;
  readonly name: string;
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
    // Strip bullet markers from individual lines but keep the text.
    const stripped = line.replace(/^[•\-*]\s+/, '');
    current.push(stripped);
  }
  if (current.length > 0) {
    paragraphs.push(current.join(' '));
  }
  return paragraphs.join('\n\n').trim();
}

function parseFeatBody(
  name: string,
  bodyLines: readonly string[],
  sourcePage: number,
): FeatExtraction {
  let i = 0;
  let prerequisites: string | undefined;

  // Skip leading blanks.
  while (i < bodyLines.length && bodyLines[i].trim().length === 0) {
    i++;
  }

  // Optional prerequisite line.
  if (i < bodyLines.length) {
    const match = isPrereqLine(bodyLines[i]);
    if (match !== null) {
      prerequisites = match[1].trim();
      i++;
    }
  }

  const descLines = bodyLines.slice(i);
  const description = joinParagraphs(descLines);

  return {
    name,
    ...(prerequisites !== undefined ? { prerequisites } : {}),
    description: description.length > 0 ? description : name,
    sourcePage,
  };
}

/**
 * Parse feat entries from the narrowed feats-section `PageText[]`.
 * Returns a `FeatExtraction[]` sorted by name.
 */
export function parseFeats(pages: readonly PageText[]): FeatExtraction[] {
  const flat = flatten(pages);
  if (flat.length === 0) return [];

  // First pass: identify feat-name line indices.
  // A line is treated as a feat name when it satisfies `isFeatName` AND either:
  //   - it is the first non-blank line in the section, or
  //   - the previous non-blank line was blank, or
  //   - it starts a new page (page boundary resets the boundary state).
  const entries: FeatEntry[] = [];
  let prevWasBoundary = true; // treat start-of-section as after a boundary
  let currentPage = flat[0]?.page;

  for (let i = 0; i < flat.length; i++) {
    const { line, page } = flat[i];
    const trimmed = line.trim();

    // Page boundary resets the "after blank" state.
    if (page !== currentPage) {
      currentPage = page;
      prevWasBoundary = true;
    }

    if (trimmed.length === 0) {
      prevWasBoundary = true;
      continue;
    }

    if (prevWasBoundary && isFeatName(trimmed)) {
      entries.push({ nameIdx: i, name: trimmed });
    }

    prevWasBoundary = false;
  }

  if (entries.length === 0) return [];

  // Second pass: collect body for each entry.
  const out: FeatExtraction[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const bodyStart = entry.nameIdx + 1;
    const bodyEnd = entries[i + 1]?.nameIdx ?? flat.length;
    const bodyLines = flat.slice(bodyStart, bodyEnd).map((f) => f.line);
    const sourcePage = flat[entry.nameIdx].page;
    out.push(parseFeatBody(entry.name, bodyLines, sourcePage));
  }

  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}
