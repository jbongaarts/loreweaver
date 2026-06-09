/**
 * Spellcasting-services rule parser for the D&D 5e SRD 5.1 importer
 * (eshyra-0m9.19).
 *
 * The "Spellcasting Services" subsection (p74, in the Equipment chapter's
 * Expenses region) is the one part of the services/expenses material that is
 * pure prose — the SRD states "no established pay rates exist", so there is no
 * cost table to reconstruct. The bead requires it to be retrievable as rules
 * data rather than lost prose, so it is emitted as a single `rule` record
 * (`rule:spellcasting-services`) with the re-flowed body in `data.text`.
 *
 * Input is the "Expenses" slice already narrowed by the orchestrator; this
 * parser locates the heading inside it and reads to the next chapter heading
 * ("Feats"). It returns `undefined` when the heading is absent so reduced
 * fixture PDFs degrade cleanly.
 */

import type { PageText, RuleExtraction } from './types.js';

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

const SPELLCASTING_SERVICES_ANCHOR = /^Spellcasting Services$/i;
// The subsection ends at the next chapter heading. "Feats" is the chapter that
// immediately follows in the SRD 5.1 PDF; the others are defense-in-depth.
const SPELLCASTING_SERVICES_END =
  /^(Feats?|Using Ability Scores|Adventuring|Combat|Monsters|Magic Items|Multiclassing|Backgrounds|Appendix)\b/i;

/**
 * Re-flow extracted lines into a single prose block: collapse intra-line
 * whitespace, join soft-wrapped lines with a space, and stitch hyphenated
 * line-break splits ("self-" + "destructive" -> "self-destructive").
 */
function reflow(lines: readonly string[]): string {
  let out = '';
  for (const raw of lines) {
    const part = raw.replace(/\s+/g, ' ').trim();
    if (part.length === 0) continue;
    if (out.length === 0) {
      out = part;
    } else if (out.endsWith('-') && /^[a-z]/.test(part)) {
      out = out.slice(0, -1) + part;
    } else {
      out += ` ${part}`;
    }
  }
  return out.trim();
}

/**
 * Parse the Spellcasting Services prose from the narrowed Expenses-region
 * `PageText[]`. Returns a single `RuleExtraction`, or `undefined` if the
 * heading is not present.
 */
export function parseSpellcastingServices(
  pages: readonly PageText[],
): RuleExtraction | undefined {
  const flat = flatten(pages);
  const anchorIdx = flat.findIndex((f) =>
    SPELLCASTING_SERVICES_ANCHOR.test(f.line.trim()),
  );
  if (anchorIdx === -1) return undefined;

  const bodyLines: string[] = [];
  for (let i = anchorIdx + 1; i < flat.length; i++) {
    const line = flat[i].line.trim();
    if (SPELLCASTING_SERVICES_END.test(line)) break;
    bodyLines.push(line);
  }

  const text = reflow(bodyLines);
  if (text.length === 0) return undefined;
  return {
    name: 'Spellcasting Services',
    keySlug: 'spellcasting-services',
    text,
    sourcePage: flat[anchorIdx].page,
  };
}
