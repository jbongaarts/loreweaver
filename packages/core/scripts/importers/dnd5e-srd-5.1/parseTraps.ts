/**
 * Sample-trap parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` already narrowed to the gamemastering
 * "Traps" section (see the `traps` anchor in `sections.ts`); output is a
 * `TrapExtraction[]` with stable shape, sorted by name.
 *
 * The SRD's "Traps" section opens with general trap-running guidance (Traps in
 * Play, Triggering a Trap, Detecting and Disabling a Trap, Trap Effects, Complex
 * Traps) and two reference tables, then an alphabetic "Sample Traps" run. This
 * parser extracts only the SAMPLE TRAPS — each of which is introduced by its
 * name line followed by a verbatim "Mechanical trap" or "Magic trap" subtitle
 * line. That subtitle is the reliable per-entry anchor (the section's prose
 * mentions "Mechanical traps include pits…" and "Magic traps are either…", but
 * never as a standalone, exact line), so scanning for `^(Mechanical|Magic)
 * trap$` locates exactly the eight sample traps and nothing in the leading
 * guidance prose. The two trap tables (Trap Save DCs and Attack Bonuses; Damage
 * Severity by Level) are reconstructed separately by `parseTables` from the same
 * slice; the general guidance prose is intentionally not emitted (DM-facing
 * procedure, not a lookupable game entity) — see the importer README.
 *
 * Sample traps use plain prose paragraphs (no bullet-point effects; "Pits"
 * inlines its four bold variant lead-ins, e.g. "Simple Pit."), so the body
 * parser re-flows wrapped lines into paragraph-separated text, mirroring
 * `parseHazards`.
 */

import type { PageText, TrapExtraction, TrapKind } from './types.js';

/** Verbatim subtitle line that follows every sample-trap name. */
const TRAP_TYPE_LINE = /^(Mechanical|Magic) trap$/;

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

interface TrapEntry {
  /** Index of the trap's name line (the line immediately before its subtitle). */
  readonly nameIdx: number;
  readonly name: string;
  readonly trapType: TrapKind;
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
 * Parse sample-trap entries from the narrowed "Traps" section `PageText[]`.
 * Returns a `TrapExtraction[]` sorted by name. The leading guidance prose and
 * the two trap tables before the first sample trap are skipped — a sample
 * trap is recognized only by its name line + "Mechanical/Magic trap" subtitle.
 */
export function parseTraps(pages: readonly PageText[]): TrapExtraction[] {
  const flat = flatten(pages);

  const entries: TrapEntry[] = [];
  for (let i = 1; i < flat.length; i++) {
    const match = TRAP_TYPE_LINE.exec(flat[i].line.trim());
    if (match === null) continue;
    const name = flat[i - 1].line.trim();
    // A sample-trap name is a single short heading line; guard against a
    // subtitle that is preceded by an empty or implausibly long prose line.
    if (name.length === 0) continue;
    entries.push({
      nameIdx: i - 1,
      name,
      trapType: match[1].toLowerCase() as TrapKind,
    });
  }

  if (entries.length === 0) return [];

  const out: TrapExtraction[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    // Body runs from just after the subtitle line to just before the next
    // trap's name line (or the end of the slice for the last trap).
    const bodyStart = entry.nameIdx + 2;
    const bodyEnd = entries[i + 1]?.nameIdx ?? flat.length;
    const bodyLines = flat.slice(bodyStart, bodyEnd).map((f) => f.line);
    const sourcePage = flat[entry.nameIdx].page;
    const description = joinParagraphs(bodyLines);
    out.push({
      name: entry.name,
      trapType: entry.trapType,
      description: description.length > 0 ? description : entry.name,
      sourcePage,
    });
  }

  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}
