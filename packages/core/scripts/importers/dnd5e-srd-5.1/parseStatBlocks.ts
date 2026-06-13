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
  readonly abilityScores?: CreatureAbilityScores;
}

/** Scan a stat-block body for the core keyed lines. First match wins (mirrors parseCreatures). */
function readStatBlock(lines: readonly string[]): StatBlockFields {
  let armorClass: number | undefined;
  let hitPoints: StatBlockHitPoints | undefined;
  let speed: Record<string, number> | undefined;
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
      }
    }
  }

  return { armorClass, hitPoints, speed, abilityScores };
}

// ---------------------------------------------------------------------------
// Keyed trailing fields (Saving Throws … Challenge). These preserve the rest of
// the source stat block so the record is not silently incomplete once 4a7.8
// de-duplicates the inline prose from the containing item's description
// (eshyra-4a7.4). The label order matches a 5e stat block.
// ---------------------------------------------------------------------------

/** Maps the SRD label to the emitted field name, in stat-block print order. */
const KEYED_FIELDS: ReadonlyArray<readonly [label: string, field: string]> = [
  ['Saving Throws', 'savingThrows'],
  ['Skills', 'skills'],
  ['Damage Vulnerabilities', 'damageVulnerabilities'],
  ['Damage Resistances', 'damageResistances'],
  ['Damage Immunities', 'damageImmunities'],
  ['Condition Immunities', 'conditionImmunities'],
  ['Senses', 'senses'],
  ['Languages', 'languages'],
  ['Challenge', 'challenge'],
];
const KEYED_LABELS = KEYED_FIELDS.map(([label]) => label);

/** Raw-body lines to scan for keyed fields after a block's meta line. */
const RAW_KEYED_WINDOW = 40;

/** A real CR token starts with a digit or a dash (em/en/hyphen for "no CR"). */
const CR_TOKEN = /^(?:\d|[—–-])/;

export interface StatBlockKeyedFields {
  readonly savingThrows?: string;
  readonly skills?: string;
  readonly damageVulnerabilities?: string;
  readonly damageResistances?: string;
  readonly damageImmunities?: string;
  readonly conditionImmunities?: string;
  readonly senses?: string;
  readonly languages?: string;
  readonly challengeRating?: string;
  readonly experiencePoints?: number;
}

const CHALLENGE_VALUE = /^(\S+)(?:\s*\(\s*([\d,]+)\s*XP\s*\))?/;

function applyChallenge(
  out: Record<string, unknown>,
  rawValue: string | undefined,
): void {
  if (rawValue === undefined) return;
  const m = CHALLENGE_VALUE.exec(rawValue.trim());
  if (m === null) return;
  // Guard against a non-CR "Challenge …" line leaking in (e.g. the Monsters
  // chapter "Challenge Rating" heading): a real CR token is a number, a
  // fraction, or the "—" the SRD prints for no challenge rating.
  if (!CR_TOKEN.test(m[1])) return;
  // The CR token is preserved verbatim, INCLUDING the "—" the SRD prints for a
  // creature with no meaningful challenge rating (Avatar of Death), so the
  // source line is never silently dropped.
  out.challengeRating = m[1];
  if (m[2] !== undefined) {
    out.experiencePoints = Number.parseInt(m[2].replace(/,/g, ''), 10);
  }
}

/**
 * Extract the keyed trailing fields. When a clean, two-column-reflowed text for
 * the block is available (the containing magic item's description, which
 * `parseMagicItems` has already de-interleaved), parse label-delimited so values
 * that WRAP across columns in the raw lines (Avatar of Death's Condition
 * Immunities and Senses) are captured complete. Otherwise fall back to per-line
 * parsing of the raw body, which is correct for blocks whose keyed values each
 * fit on a single source line (Giant Fly).
 */
function extractKeyedFields(
  rawBody: readonly string[],
  name: string,
  cleanText: string | undefined,
): StatBlockKeyedFields {
  const raw: Record<string, string> = {};
  if (cleanText !== undefined) {
    const startIdx = cleanText.indexOf(name);
    const text = startIdx >= 0 ? cleanText.slice(startIdx) : cleanText;
    const positions = KEYED_LABELS.map((label) => ({
      label,
      idx: text.indexOf(label),
    }))
      .filter((p) => p.idx >= 0)
      .sort((a, b) => a.idx - b.idx);
    for (let i = 0; i < positions.length; i++) {
      const { label, idx } = positions[i];
      const end = i + 1 < positions.length ? positions[i + 1].idx : text.length;
      raw[label] = text.slice(idx + label.length, end).trim();
    }
  } else {
    // The body slice runs to the NEXT stat-block candidate, which for an
    // inline block can be many pages away (the first Monsters-chapter creature).
    // A block's trailing keyed section sits immediately after its ability-score
    // row, so bound the raw scan to a small window after the meta line. This
    // keeps an ABSENT field from false-matching distant unrelated text — e.g.
    // Giant Fly has no Challenge line, and the Monsters chapter's "Challenge
    // Rating" heading must not be mistaken for one.
    for (const line of rawBody.slice(0, RAW_KEYED_WINDOW)) {
      const trimmed = line.trim();
      for (const label of KEYED_LABELS) {
        if (raw[label] !== undefined) continue;
        if (
          trimmed.startsWith(`${label} `) ||
          trimmed.startsWith(`${label}\t`)
        ) {
          raw[label] = trimmed.slice(label.length).trim();
        }
      }
    }
  }

  const out: Record<string, unknown> = {};
  for (const [label, field] of KEYED_FIELDS) {
    if (label === 'Challenge') continue;
    const value = raw[label];
    if (value !== undefined && value.length > 0) out[field] = value;
  }
  applyChallenge(out, raw.Challenge);
  return out as StatBlockKeyedFields;
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
  /**
   * Optional map from a stat-block name to a clean, two-column-reflowed text
   * that contains the full block (the containing magic item's description). When
   * present, the keyed trailing fields are parsed from it so values that wrap
   * across columns in the raw page lines are captured complete. Blocks absent
   * from this map fall back to per-line parsing of the raw body.
   */
  readonly cleanTextByName?: ReadonlyMap<string, string>;
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

    const keyed = extractKeyedFields(
      body,
      candidate.name,
      options.cleanTextByName?.get(candidate.name),
    );

    out.push({
      name: candidate.name,
      size: candidate.size,
      type: candidate.type,
      alignment: candidate.alignment,
      armorClass: fields.armorClass,
      hitPoints: fields.hitPoints,
      speed: fields.speed,
      abilityScores: fields.abilityScores,
      ...keyed,
      sourcePage,
      containingItem,
    });
  }

  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}
