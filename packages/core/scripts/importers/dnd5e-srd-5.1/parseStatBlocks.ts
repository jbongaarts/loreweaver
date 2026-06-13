/**
 * Document-wide inline stat-block parser for the D&D 5e SRD 5.1 importer
 * (eshyra-4a7.4).
 *
 * The Monsters chapter / Appendix MM-A / Appendix MM-B stat blocks are owned by
 * `parseCreatures`, which runs over deterministically narrowed slices and emits
 * strict `creature` records. But the SRD also prints a handful of *abbreviated*
 * combat stat blocks INLINE under other entries — Avatar of Death inside the
 * Deck of Many Things (p218) and Giant Fly inside the Figurine of Wondrous Power
 * (p222). Those were previously swallowed into magic-item prose; the source
 * inventory flags them (`structure: 'stat-block'`) but nothing emitted them.
 *
 * This parser scans the WHOLE document for stat-block-shaped content using the
 * same name/meta-line grammar as `parseCreatures` (shared, exported helpers),
 * then keeps only candidates that are NOT already emitted as a creature/NPC
 * (`excludeNames`). Each survivor is emitted as a permissive `stat-block`
 * record, because these abbreviated blocks diverge from a full creature in ways
 * the strict `creature` schema rejects:
 *   - hit points may be a derived/textual amount ("half the hit point maximum
 *     of its summoner") rather than an integer;
 *   - the challenge rating may be absent (Giant Fly) or printed as "—" (Avatar
 *     of Death).
 *
 * Fail-closed: every surviving stat block must appear in `containingItemByName`
 * (the reviewed inline-block -> containing-entry map). A confirmed stat block
 * outside that map is a genuinely novel inline block the importer has never
 * seen, so the parser throws rather than emit an unattributed record. The
 * orchestrator additionally gates the parsed name set against an exact baseline.
 *
 * Pure and deterministic: same pages + options always yield the same array,
 * sorted by name.
 */

import {
  AC_PATTERN,
  CHALLENGE_PATTERN,
  type FlatLine,
  findPrecedingNameIdx,
  flatten,
  parseAbilityScores,
  parseMetaLine,
  parseSpeed,
  SPEED_PATTERN,
} from './parseCreatures.js';
import type {
  CreatureAbilityScores,
  PageText,
  StatBlockExtraction,
  StatBlockHitPoints,
} from './types.js';

/**
 * Permissive hit-points line: capture everything after "Hit Points". Unlike the
 * strict integer-only creature pattern, this also accepts derived/textual HP.
 */
const HP_LINE_PATTERN = /^Hit Points\s+(.+?)\s*$/;
/** A leading fixed amount with an optional "(dice)" expression: "19 (3d10 + 3)". */
const HP_FIXED_PATTERN = /^(\d+)\s*(?:\(([^)]+)\))?\s*$/;

function parseHitPoints(rawAfterLabel: string): StatBlockHitPoints {
  const fixed = HP_FIXED_PATTERN.exec(rawAfterLabel.trim());
  if (fixed !== null) {
    const value = Number.parseInt(fixed[1], 10);
    const formula = fixed[2]?.trim();
    return formula !== undefined && formula.length > 0
      ? { value, formula }
      : { value };
  }
  return { special: rawAfterLabel.trim() };
}

interface StatBlockFields {
  readonly armorClass?: number;
  readonly hitPoints?: StatBlockHitPoints;
  readonly speed?: Record<string, number>;
  readonly challengeRating?: string;
  readonly abilityScores?: CreatureAbilityScores;
}

/** Scan a stat-block body for the keyed lines. First match wins (mirrors parseCreatures). */
function readStatBlock(lines: readonly string[]): StatBlockFields {
  let armorClass: number | undefined;
  let hitPoints: StatBlockHitPoints | undefined;
  let speed: Record<string, number> | undefined;
  let challengeRating: string | undefined;
  let abilityScores: CreatureAbilityScores | undefined;

  for (const raw of lines) {
    const line = raw.trim();
    if (armorClass === undefined) {
      const m = AC_PATTERN.exec(line);
      if (m !== null) {
        armorClass = Number.parseInt(m[1], 10);
        continue;
      }
    }
    if (hitPoints === undefined) {
      const m = HP_LINE_PATTERN.exec(line);
      if (m !== null) {
        hitPoints = parseHitPoints(m[1]);
        continue;
      }
    }
    if (speed === undefined) {
      const m = SPEED_PATTERN.exec(line);
      if (m !== null) {
        speed = parseSpeed(m[1]);
        continue;
      }
    }
    if (abilityScores === undefined) {
      const parsed = parseAbilityScores(line);
      if (parsed !== null) {
        abilityScores = parsed;
        continue;
      }
    }
    if (challengeRating === undefined) {
      // Real CR only — an em-dash "—" CR (Avatar of Death) does not match, so
      // the abbreviated block legitimately ends up with no challengeRating.
      const m = CHALLENGE_PATTERN.exec(line);
      if (m !== null) {
        challengeRating = m[1];
      }
    }
  }

  return { armorClass, hitPoints, speed, challengeRating, abilityScores };
}

interface Candidate {
  readonly nameIdx: number;
  readonly metaIdx: number;
  readonly name: string;
  readonly size: string;
  readonly type: string;
  readonly alignment: string;
}

export interface ParseStatBlocksOptions {
  /**
   * Names already emitted as `creature` records (monsters + NPCs). Candidates
   * with these names are owned by `parseCreatures` and skipped here.
   */
  readonly excludeNames: ReadonlySet<string>;
  /**
   * Reviewed map from an inline stat-block name to the entry it is printed
   * under. Every emitted stat block must be present; an unknown one fails closed.
   */
  readonly containingItemByName: ReadonlyMap<string, string>;
}

/**
 * Parse abbreviated inline stat blocks from a full `PageText[]`. Returns a
 * `StatBlockExtraction[]` sorted by name. See the module header for the model.
 */
export function parseStatBlocks(
  pages: readonly PageText[],
  options: ParseStatBlocksOptions,
): StatBlockExtraction[] {
  const flat: readonly FlatLine[] = flatten(pages);

  const candidates: Candidate[] = [];
  flat.forEach((entry, metaIdx) => {
    const meta = parseMetaLine(entry.line);
    if (meta === null) return;
    const nameIdx = findPrecedingNameIdx(flat, metaIdx);
    if (nameIdx === null) return;
    candidates.push({
      nameIdx,
      metaIdx,
      name: flat[nameIdx].line.trim(),
      size: meta.size,
      type: meta.type,
      alignment: meta.alignment,
    });
  });

  const out: StatBlockExtraction[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (options.excludeNames.has(candidate.name)) continue;

    const next = candidates[i + 1];
    const bodyEnd = next?.nameIdx ?? flat.length;
    const body = flat.slice(candidate.metaIdx + 1, bodyEnd).map((f) => f.line);
    const fields = readStatBlock(body);

    // A stat block is confirmed by armor class + ability scores + some hit-point
    // form. Prose that merely reads like a meta line lacks this signature and is
    // skipped (defense-in-depth against false positives across the whole doc).
    if (
      fields.armorClass === undefined ||
      fields.abilityScores === undefined ||
      fields.hitPoints === undefined
    ) {
      continue;
    }

    const sourcePage = flat[candidate.metaIdx].page;
    const containingItem = options.containingItemByName.get(candidate.name);
    if (containingItem === undefined) {
      throw new Error(
        `inline stat block "${candidate.name}" at page ${sourcePage} is not in the reviewed containing-item map — a novel inline stat block needs review (eshyra-4a7.4)`,
      );
    }
    if (fields.speed === undefined) {
      throw new Error(
        `inline stat block "${candidate.name}" at page ${sourcePage} is missing a Speed line`,
      );
    }

    out.push({
      name: candidate.name,
      size: candidate.size,
      type: candidate.type,
      alignment: candidate.alignment,
      armorClass: fields.armorClass,
      hitPoints: fields.hitPoints,
      speed: fields.speed,
      ...(fields.challengeRating !== undefined
        ? { challengeRating: fields.challengeRating }
        : {}),
      abilityScores: fields.abilityScores,
      sourcePage,
      containingItem,
    });
  }

  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}
