/**
 * Sample-poison parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` already narrowed to the gamemastering
 * "Poisons" section (see the `poisons` anchor in `sections.ts`); output is a
 * `PoisonExtraction[]` with stable shape, sorted by name.
 *
 * The SRD's "Poisons" section has three parts: general guidance prose with the
 * four poison-type definitions (Contact, Ingested, Inhaled, Injury), a "Poisons"
 * reference table (Item / Type / Price per Dose) listing all 14 poisons, and a
 * "Sample Poisons" run where each poison's effect is described. Each sample
 * entry opens with an inline bold lead-in of the form `Name (Type). <effect…>`
 * on one baseline (e.g. "Assassin's Blood (Ingested). A creature subjected to…")
 * — distinct from traps (a name line + "Mechanical/Magic trap" subtitle) and
 * diseases (a bare name heading). This parser keys off that lead-in:
 *
 *   - Sample entries are located by the lead-in regex `^Name (Type). …`. The
 *     name (title case) and type (the parenthetical) are the structured fields;
 *     the rest of the lead-in line plus the following lines (up to the next
 *     lead-in) are the re-flowed effect description. The four-type guidance prose
 *     ("Contact. Contact poison can be…") has no parenthetical, so it never
 *     matches; it is intentionally not emitted (general guidance, like the trap
 *     procedure prose).
 *   - The price per dose is read from the reference-table rows (`Name Type
 *     <n> gp`) and attached to the matching sample entry by normalized name. The
 *     table is not emitted as a separate `table` record — the price folds into
 *     each poison's `data.price`, mirroring how each magic item carries its own
 *     structured fields.
 *
 * The lead-in and table-row patterns are mutually exclusive (one has a
 * parenthesized type and a period, the other ends in "<n> gp"), so the parser
 * scans the whole slice for both without needing to split on the "Sample
 * Poisons" caption.
 *
 * Poisons emit under the `hazard` record kind with `data.category: 'poison'`
 * (see `poisonExtractionsToRecords` and the importer README): like traps and
 * diseases, a poison is a description-only danger with a save DC and effects, so
 * it satisfies the same `hazard` kindSchema without minting a new exhaustive
 * kind. The save DC and damage stay inside the effect `description` rather than
 * being parsed out of the prose.
 */

import type { PageText, PoisonExtraction, PoisonType } from './types.js';

/** Inline bold lead-in that opens every sample poison: `Name (Type). effect…`. */
const SAMPLE_LEAD_IN = /^(.+?) \((Contact|Ingested|Inhaled|Injury)\)\.\s*(.*)$/;

/** A reference-table row: `Name Type <price> gp`. */
const TABLE_ROW = /^(.+?)\s+(Contact|Ingested|Inhaled|Injury)\s+([\d,]+\s*gp)$/;

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

/** Normalize a poison name for cross-referencing the table against the lead-in
 *  (the table prints "Assassin's blood", the lead-in "Assassin's Blood"). */
function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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

interface PoisonEntry {
  /** Index of the lead-in line in the flattened slice. */
  readonly leadIdx: number;
  readonly name: string;
  readonly poisonType: PoisonType;
  /** First-line text after the `Name (Type). ` lead-in. */
  readonly firstLineRemainder: string;
}

/**
 * Parse sample-poison entries from the narrowed "Poisons" section `PageText[]`.
 * Returns a `PoisonExtraction[]` sorted by name. The four-type guidance prose
 * and the reference table before the first sample entry are skipped — a sample
 * poison is recognized only by its `Name (Type).` lead-in. Each entry's price is
 * attached from the matching reference-table row when present.
 */
export function parsePoisons(pages: readonly PageText[]): PoisonExtraction[] {
  const flat = flatten(pages);

  // First pass: price per dose, keyed by normalized poison name.
  const priceByName = new Map<string, string>();
  for (const { line } of flat) {
    const match = TABLE_ROW.exec(line.trim());
    if (match === null) continue;
    const key = nameKey(match[1]);
    const price = match[3].replace(/\s+/g, ' ').trim();
    if (!priceByName.has(key)) priceByName.set(key, price);
  }

  // Second pass: locate the sample-entry lead-ins.
  const entries: PoisonEntry[] = [];
  for (let i = 0; i < flat.length; i++) {
    const match = SAMPLE_LEAD_IN.exec(flat[i].line.trim());
    if (match === null) continue;
    entries.push({
      leadIdx: i,
      name: match[1].trim(),
      poisonType: match[2].toLowerCase() as PoisonType,
      firstLineRemainder: match[3].trim(),
    });
  }

  if (entries.length === 0) return [];

  const out: PoisonExtraction[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const bodyStart = entry.leadIdx + 1;
    const bodyEnd = entries[i + 1]?.leadIdx ?? flat.length;
    const bodyLines = [
      entry.firstLineRemainder,
      ...flat.slice(bodyStart, bodyEnd).map((f) => f.line),
    ];
    const description = joinParagraphs(bodyLines);
    const sourcePage = flat[entry.leadIdx].page;
    const price = priceByName.get(nameKey(entry.name));
    out.push({
      name: entry.name,
      poisonType: entry.poisonType,
      ...(price === undefined ? {} : { price }),
      description: description.length > 0 ? description : entry.name,
      sourcePage,
    });
  }

  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}
