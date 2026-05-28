/**
 * Deterministic section slicer for the D&D 5e SRD 5.1 importer.
 *
 * Each kind parser (parseSpells, future creature parser, etc.) is responsible
 * only for its narrow input shape. The orchestrator is responsible for
 * narrowing the extracted `PageText[]` to the section that parser cares
 * about. This module provides that narrowing.
 *
 * Boundary semantics:
 * - A section starts at the first line that matches `startHeading`. The
 *   heading line itself is excluded from the returned content.
 * - A section ends at the first line after `startHeading` that matches
 *   `endHeading`. The end-heading line is excluded from the returned content.
 * - If `endHeading` is unmatched the section continues to the end of the
 *   PDF UNLESS `requireEndHeading` is true, in which case the function
 *   throws `SectionNotFoundError`. If `startHeading` is unmatched the
 *   function always throws `SectionNotFoundError` — failing closed is the
 *   whole point of this module: better to refuse to run than silently parse
 *   the wrong content.
 *
 * The default anchors target the SRD 5.1 PDF's chapter headings. They are
 * exported so callers can override them when (a) a tuned anchor proves
 * necessary once the real PDF is vendored, or (b) a different SRD version /
 * structure is imported in the future.
 */

import type { PageText } from './types.js';

export interface SectionAnchorOptions {
  /**
   * Regex that matches the chapter / section heading line that starts the
   * section. Matched against `line.trim()`; usually anchored with `^...$`.
   */
  readonly startHeading: RegExp;
  /**
   * Regex that matches the chapter / section heading line that immediately
   * follows the section. The slice ends just before this line. If undefined
   * or unmatched, behavior depends on `requireEndHeading`.
   */
  readonly endHeading?: RegExp;
  /**
   * If true and `endHeading` is set but does not match any line after
   * `startHeading`, `sliceSection` throws `SectionNotFoundError('end', ...)`
   * instead of silently slicing to EOF. Use this for sections where
   * misidentifying the boundary would let later chapters bleed into a kind
   * parser (e.g. the spell-descriptions section, where a missing "Monsters"
   * end heading would feed monster stat blocks to `parseSpells`).
   *
   * Default: false (preserves the slice-to-EOF fallback for sections that
   * legitimately run to the end of the document).
   */
  readonly requireEndHeading?: boolean;
}

export class SectionNotFoundError extends Error {
  constructor(
    public readonly which: 'start' | 'end',
    public readonly pattern: RegExp,
  ) {
    super(
      `${which} heading not found: no line matched ${pattern}. Check the vendored PDF, or override the anchor patterns via the \`sectionAnchors\` option on runImporter.`,
    );
    this.name = 'SectionNotFoundError';
  }
}

interface Location {
  /** 0-based index into `PageText[]`. */
  readonly pageIdx: number;
  /** 0-based index into `pages[pageIdx].lines`. */
  readonly lineIdx: number;
}

function findFirstMatch(
  pages: readonly PageText[],
  pattern: RegExp,
  startAfter?: Location,
): Location | null {
  const startPage = startAfter?.pageIdx ?? 0;
  for (let p = startPage; p < pages.length; p++) {
    const lines = pages[p].lines;
    const startLine =
      startAfter !== undefined && p === startAfter.pageIdx
        ? startAfter.lineIdx + 1
        : 0;
    for (let l = startLine; l < lines.length; l++) {
      if (pattern.test(lines[l].trim())) {
        return { pageIdx: p, lineIdx: l };
      }
    }
  }
  return null;
}

/**
 * Slice the section delimited by `anchors`. Throws `SectionNotFoundError` if
 * `startHeading` doesn't match; never silently returns the whole input.
 * `endHeading` may be unmatched — in that case the section runs to the end
 * of the input, UNLESS `requireEndHeading` is true, in which case the
 * unmatched end also throws `SectionNotFoundError`.
 */
export function sliceSection(
  pages: readonly PageText[],
  anchors: SectionAnchorOptions,
): readonly PageText[] {
  const start = findFirstMatch(pages, anchors.startHeading);
  if (start === null) {
    throw new SectionNotFoundError('start', anchors.startHeading);
  }
  const end =
    anchors.endHeading === undefined
      ? null
      : findFirstMatch(pages, anchors.endHeading, start);
  if (
    anchors.endHeading !== undefined &&
    anchors.requireEndHeading === true &&
    end === null
  ) {
    throw new SectionNotFoundError('end', anchors.endHeading);
  }
  return buildSlice(pages, start, end);
}

function buildSlice(
  pages: readonly PageText[],
  start: Location,
  end: Location | null,
): readonly PageText[] {
  const lastPageIdx = end?.pageIdx ?? pages.length - 1;
  const out: PageText[] = [];
  for (let p = start.pageIdx; p <= lastPageIdx; p++) {
    const page = pages[p];
    const firstLine = p === start.pageIdx ? start.lineIdx + 1 : 0;
    const lastLineExclusive =
      end !== null && p === end.pageIdx ? end.lineIdx : page.lines.length;
    const lines = page.lines.slice(firstLine, lastLineExclusive);
    if (lines.length > 0) {
      out.push({ pageNumber: page.pageNumber, lines });
    }
  }
  return out;
}

/**
 * Default section anchors for the SRD 5.1 PDF. The Wizards CC-BY 5.1 PDF
 * presents per-class spell lists under a "Spell Lists" chapter, immediately
 * followed by alphabetical "Spells" descriptions. The "Spells" descriptions
 * end where the next major chapter (usually "Monsters") begins.
 *
 * These regexes are deliberately tight (`^...$`) so an occurrence of the
 * heading text inside body prose won't false-positive. If the actual SRD
 * heading text differs (variant cases, different chapter title), override
 * via the `sectionAnchors` option on `runImporter`.
 */
export const SRD_5_1_DEFAULT_SECTION_ANCHORS = {
  spellLists: {
    startHeading: /^Spell Lists$/,
    endHeading: /^Spells$|^Spell Descriptions$/,
    requireEndHeading: true,
  },
  spellDescriptions: {
    startHeading: /^Spells$|^Spell Descriptions$/,
    endHeading: /^(Monsters|Magic Items|Creatures|NPCs|Treasure|Appendix)$/,
    requireEndHeading: true,
  },
} as const satisfies Record<string, SectionAnchorOptions>;

export type Srd51SectionAnchors = {
  readonly spellLists: SectionAnchorOptions;
  readonly spellDescriptions: SectionAnchorOptions;
};
