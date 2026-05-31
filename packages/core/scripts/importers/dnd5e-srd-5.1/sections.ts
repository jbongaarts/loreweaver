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
  // SRD 5.1 opens with the "Races" chapter (Dwarf, Elf, ... Tiefling), which
  // runs up to the "Classes" chapter. `requireEndHeading` is true because
  // ancestry is an implemented kind: if the end boundary is missing the
  // importer must fail closed rather than run the race parser over the class
  // chapters (which could promote class headings as bogus ancestry records).
  races: {
    startHeading: /^Races$/,
    endHeading: /^Classes$/,
    requireEndHeading: true,
  },
  // SRD 5.1 "Classes" chapter (Barbarian … Wizard), bounded below by the
  // core-rules chapter that opens at "Using Ability Scores". `requireEndHeading`
  // is true because class is an implemented kind: if the end boundary is missing
  // the importer must fail closed rather than run the class parser over the
  // core-rules / spell chapters. The parser keys off each class's
  // "Hit Dice: 1dN per <class> level" signature line, so a widened slice cannot
  // promote arbitrary headings as classes, but failing closed keeps the slice
  // honest. See ADR 0009 and loreweaver-0m9.5.2.
  classes: {
    startHeading: /^Classes$/,
    endHeading: /^Using Ability Scores$/,
    requireEndHeading: true,
  },
  // Core-rules chapters (ability checks, adventuring, combat, etc.) begin at
  // "Using Ability Scores" and run up to (but not including) "Spell Lists".
  // This slice feeds the generic rule-text parser.
  coreRules: {
    startHeading: /^Using Ability Scores$/,
    endHeading: /^Spell Lists$/,
    requireEndHeading: true,
  },
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
  // SRD 5.1 "Actions in Combat" section. `requireEndHeading` is true because
  // actions is an implemented kind: if the next-heading boundary is missing,
  // fail closed rather than letting the slice run to EOF and absorb later
  // combat chapter text into the final action description.
  combatActions: {
    startHeading: /^Actions in Combat$/,
    endHeading:
      /^(Making an Attack|Movement and Position|Reactions?|Bonus Actions?|Mounted Combat|Underwater Combat|Contests in Combat|Cover)$/i,
    requireEndHeading: true,
  },
  // SRD 5.1 puts conditions in "Appendix A: Conditions" near the end of the
  // document. The end heading is optional (the section may run to EOF in some
  // PDF layouts), so requireEndHeading is not set.
  conditions: {
    startHeading: /^Appendix A: Conditions$|^Conditions$/,
    endHeading:
      /^Appendix [B-Z]:|^Open Game License|^Legal Information|^Monster (Statistics|Lists?)$/i,
  },
  // SRD 5.1 places feats under "Feats" in Chapter 6 (Customization Options).
  // requireEndHeading is true because feats is an implemented kind: if the PDF
  // changes such that the end anchor is not found, the importer must fail closed
  // rather than silently run parseFeats over subsequent chapters (which could
  // promote chapter headings as bogus feat records).
  // Two alternatives cover different PDF layouts:
  //   - The main alternation matches common chapter headings (full-line match).
  //   - The ^Appendix\b alternative matches any "Appendix X: ..." heading
  //     (which the $ anchor would prevent if written inside the group).
  feats: {
    startHeading: /^Feats?$|^Feat Descriptions?$/,
    endHeading:
      /^(Using Ability Scores|Adventuring|Combat|Equipment|Monsters|Magic Items|Running the Game|Chapter \d+|Spell Lists?)$|^Appendix\b/i,
    requireEndHeading: true,
  },
  // SRD 5.1 places hazards in "Dungeon Hazards" within the DM tools / running
  // the game section. Hazards is an implemented kind, so the importer must
  // fail closed if the next section heading is missing instead of letting the
  // slice run to EOF and absorb later prose into the final hazard.
  hazards: {
    startHeading: /^Dungeon Hazards$|^Hazards$/,
    endHeading:
      /^(Traps|Sample Traps|Wilderness Hazards|Monsters|Magic Items|Appendix|Chapter \d+|Open Game License|Legal Information)$/i,
    requireEndHeading: true,
  },
  // SRD 5.1 places weapons, armor, and adventuring gear in the "Equipment"
  // chapter. requireEndHeading is true because equipment is an implemented
  // kind: if the next-section boundary is missing, fail closed rather than let
  // the slice run to EOF and feed later chapters to the equipment parser. The
  // end alternation covers the subsections that follow the Adventuring Gear
  // table (Mounts and Vehicles, Trade Goods, ...) and the chapters that follow
  // the Equipment chapter (Multiclassing, Spellcasting, ...).
  equipment: {
    startHeading: /^Equipment$/,
    endHeading:
      /^(Mounts and Vehicles|Trade Goods|Expenses|Trinkets|Multiclassing|Spellcasting|Using Ability Scores|Adventuring|Combat|Monsters|Magic Items|Chapter \d+)$/i,
    requireEndHeading: true,
  },
  // SRD 5.1 presents creature stat blocks alphabetically under the "Monsters"
  // chapter, bounded below by the "Nonplayer Characters" section (NPC stat
  // blocks, intentionally out of scope for the creature kind) and the license
  // text. `requireEndHeading` is true: creature is an implemented kind, so a
  // missing end boundary must fail closed rather than let the slice run to EOF
  // and feed trailing appendix / NPC / legal content to the creature parser.
  // The end alternation is kept tight to the sections that actually follow the
  // Monsters chapter so a stray heading can't widen the slice.
  monsters: {
    startHeading: /^Monsters$/,
    endHeading:
      /^(Nonplayer Characters|NPCs|Appendix|Open Game License|Legal Information)\b/i,
    requireEndHeading: true,
  },
  // SRD 5.1 treasure tables live in the "Treasure" section, before the
  // following magic-item rules. Use the first rules heading inside that next
  // section as the end boundary instead of "Magic Items" itself because
  // "Magic Items" is also a treasure-hoard table column header.
  treasureTables: {
    startHeading: /^Treasure$/,
    endHeading: /^Using (a )?Magic Items?$/i,
    requireEndHeading: true,
  },
  // SRD 5.1 "Multiclassing" section. Only the "Prerequisites" listing at the top
  // of the section is consumed (parseMulticlassing), so the end boundary is set
  // to "Proficiencies" — the subsection that immediately follows the
  // prerequisites table — to keep the slice tight. requireEndHeading is left off
  // (best-effort): the prerequisites enrichment is NOT fail-closed (ADR 0007 —
  // primaryAbilities is left empty when the source does not provide it), and the
  // orchestrator already treats a missing Multiclassing section as "no
  // enrichment available". The end alternation also lists plausible following
  // top-level headings so a layout without a "Proficiencies" subsection still
  // bounds reasonably (and the parser's exact class-name + ability-score row
  // matching makes an over-wide slice harmless). Placement of the Multiclassing
  // section varies by PDF layout; override via the `sectionAnchors` option if a
  // future vendored PDF differs. See loreweaver-0m9.5.19 and ADR 0009.
  multiclassing: {
    startHeading: /^Multiclassing$/,
    endHeading:
      /^(Proficiencies|Using Ability Scores|Beyond 1st Level|Adventuring|Combat|Spell Lists?|Monsters|Appendix [A-Z]:)/i,
  },
} as const satisfies Record<string, SectionAnchorOptions>;

export type Srd51SectionAnchors = {
  readonly races: SectionAnchorOptions;
  readonly classes: SectionAnchorOptions;
  readonly coreRules: SectionAnchorOptions;
  readonly spellLists: SectionAnchorOptions;
  readonly spellDescriptions: SectionAnchorOptions;
  readonly combatActions: SectionAnchorOptions;
  readonly monsters: SectionAnchorOptions;
  readonly conditions: SectionAnchorOptions;
  readonly feats: SectionAnchorOptions;
  readonly hazards: SectionAnchorOptions;
  readonly equipment: SectionAnchorOptions;
  readonly treasureTables: SectionAnchorOptions;
  readonly multiclassing: SectionAnchorOptions;
};
