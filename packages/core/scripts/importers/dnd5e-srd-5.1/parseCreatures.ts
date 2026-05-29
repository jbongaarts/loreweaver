/**
 * Creature stat-block parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` already narrowed to the SRD's Monsters
 * section; output is a `CreatureExtraction[]` with stable shape, sorted by
 * name. The caller (the orchestrator in `index.ts`) is responsible for
 * narrowing the input to the monsters chapter via `sliceSection`.
 *
 * A stat block is identified by its meta line — the
 * "<Size> <type>[ (subtype)], <alignment>" line that immediately follows the
 * creature's name (e.g. "Small humanoid (goblinoid), neutral evil"). The
 * parser then reads the keyed stat lines that follow (Armor Class, Hit Points,
 * Speed, the STR/DEX/CON/INT/WIS/CHA ability table, Challenge).
 *
 * Two-tier confirmation (mirrors `parseSpells`):
 *   - A meta-line candidate is only confirmed as a creature when its body
 *     carries the structural signature of a stat block: an Armor Class line, a
 *     Hit Points line, AND the ability-score table. Body prose that merely
 *     reads like a meta line (e.g. "Large beasts, such as horses, …") lacks
 *     that signature and is silently skipped — defense-in-depth against a slice
 *     that wasn't perfectly narrowed.
 *   - A confirmed creature missing Speed or Challenge is a genuine malformed
 *     stat block, so the parser throws with the creature name + page rather
 *     than emit a record that can't satisfy the kindSchema.
 */

import type {
  CreatureAbilityScores,
  CreatureExtraction,
  PageText,
} from './types.js';

const SIZES = [
  'Tiny',
  'Small',
  'Medium',
  'Large',
  'Huge',
  'Gargantuan',
] as const;
const SIZE_PATTERN = SIZES.join('|');

// The 14 SRD creature types. Used to confirm a meta-line candidate really
// names a creature type rather than being an arbitrary "<Size> <word>, …"
// sentence fragment.
const CREATURE_TYPES = [
  'aberration',
  'beast',
  'celestial',
  'construct',
  'dragon',
  'elemental',
  'fey',
  'fiend',
  'giant',
  'humanoid',
  'monstrosity',
  'ooze',
  'plant',
  'undead',
] as const;
const TYPE_WORD = new RegExp(`\\b(?:${CREATURE_TYPES.join('|')})s?\\b`);

// "<Size> <typePhrase>[ (subtype)], <alignment>". The size word is capitalized
// and the type phrase lowercased exactly as the SRD prints them, so no `i`
// flag — that keeps body prose ("In combat, …") from matching. The type phrase
// is captured loosely and validated against TYPE_WORD; the optional
// parenthetical subtype is dropped; a trailing period (if any) is stripped.
const META_PATTERN = new RegExp(
  `^(${SIZE_PATTERN})\\s+([^,()]+?)(?:\\s*\\(([^)]*)\\))?,\\s*(.+?)\\.?$`,
);

const AC_PATTERN = /^Armor Class\s+(\d+)/;
const HP_PATTERN = /^Hit Points\s+(\d+)/;
const SPEED_PATTERN = /^Speed\s+(.+)$/;
const CHALLENGE_PATTERN = /^Challenge\s+([0-9/]+)/;
const ABILITY_HEADER_PATTERN = /^STR\s+DEX\s+CON\s+INT\s+WIS\s+CHA$/i;
// Six "score (modifier)" cells, e.g. "8 (−1) 14 (+2) 10 (+0) …". Only the
// scores are captured; the parenthesized modifier may use a Unicode minus.
const ABILITY_SCORES_PATTERN = new RegExp(
  `^${Array(6).fill('(\\d+)\\s*\\([^)]*\\)').join('\\s+')}$`,
);

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

interface MetaParse {
  readonly size: string;
  readonly type: string;
  readonly alignment: string;
}

function parseMetaLine(line: string): MetaParse | null {
  const match = META_PATTERN.exec(line.trim());
  if (match === null) return null;
  const type = match[2].trim();
  if (TYPE_WORD.test(type) === false) return null;
  return {
    size: match[1],
    type,
    alignment: match[4].trim(),
  };
}

/** A creature name line is a short, capitalized, non-keyed line. */
function isLikelyCreatureName(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 60) return false;
  if (parseMetaLine(trimmed) !== null) return false;
  if (
    AC_PATTERN.test(trimmed) ||
    HP_PATTERN.test(trimmed) ||
    SPEED_PATTERN.test(trimmed) ||
    CHALLENGE_PATTERN.test(trimmed) ||
    ABILITY_HEADER_PATTERN.test(trimmed)
  ) {
    return false;
  }
  if (/^[A-Z]/.test(trimmed) === false) return false;
  return /^[A-Z][A-Za-z0-9 ,'’\-/()]*$/.test(trimmed);
}

function findPrecedingNameIdx(
  flat: readonly FlatLine[],
  metaIdx: number,
): number | null {
  let i = metaIdx - 1;
  while (i >= 0 && flat[i].line.trim().length === 0) {
    i--;
  }
  if (i < 0) return null;
  if (isLikelyCreatureName(flat[i].line) === false) return null;
  return i;
}

/**
 * Parse a Speed value ("30 ft., climb 30 ft.") into a mode→feet map. The
 * leading unlabeled segment keys as `walk`; subsequent labeled segments
 * (climb, fly, swim, burrow) key on their label. Any trailing parenthetical
 * such as "(hover)" is ignored.
 */
function parseSpeed(text: string): Record<string, number> {
  const speed: Record<string, number> = {};
  for (const raw of text.split(',')) {
    const segment = raw.trim();
    if (segment.length === 0) continue;
    const match = segment.match(/^([A-Za-z][A-Za-z ]*?\s+)?(\d+)\s*ft/);
    if (match === null) continue;
    const label = match[1]?.trim().toLowerCase();
    const key = label !== undefined && label.length > 0 ? label : 'walk';
    speed[key] = Number.parseInt(match[2], 10);
  }
  return speed;
}

function parseAbilityScores(scoresLine: string): CreatureAbilityScores | null {
  const match = ABILITY_SCORES_PATTERN.exec(scoresLine.trim());
  if (match === null) return null;
  const n = (i: number): number => Number.parseInt(match[i], 10);
  return {
    strength: n(1),
    dexterity: n(2),
    constitution: n(3),
    intelligence: n(4),
    wisdom: n(5),
    charisma: n(6),
  };
}

interface CreatureCandidate {
  readonly nameIdx: number;
  readonly metaIdx: number;
  readonly name: string;
  readonly meta: MetaParse;
}

interface StatBlockFields {
  readonly armorClass?: number;
  readonly hitPoints?: number;
  readonly speed?: Record<string, number>;
  readonly challengeRating?: string;
  readonly abilityScores?: CreatureAbilityScores;
}

/** Scan a stat-block body for the keyed stat lines. First match wins. */
function readStatBlock(lines: readonly string[]): StatBlockFields {
  let armorClass: number | undefined;
  let hitPoints: number | undefined;
  let speed: Record<string, number> | undefined;
  let challengeRating: string | undefined;
  let abilityScores: CreatureAbilityScores | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (armorClass === undefined) {
      const m = AC_PATTERN.exec(line);
      if (m !== null) {
        armorClass = Number.parseInt(m[1], 10);
        continue;
      }
    }
    if (hitPoints === undefined) {
      const m = HP_PATTERN.exec(line);
      if (m !== null) {
        hitPoints = Number.parseInt(m[1], 10);
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
    if (abilityScores === undefined && ABILITY_HEADER_PATTERN.test(line)) {
      // Scores are on the next non-blank line.
      let j = i + 1;
      while (j < lines.length && lines[j].trim().length === 0) j++;
      if (j < lines.length) {
        const parsed = parseAbilityScores(lines[j]);
        if (parsed !== null) {
          abilityScores = parsed;
          i = j;
          continue;
        }
      }
    }
    if (challengeRating === undefined) {
      const m = CHALLENGE_PATTERN.exec(line);
      if (m !== null) {
        challengeRating = m[1];
      }
    }
  }

  return { armorClass, hitPoints, speed, challengeRating, abilityScores };
}

/**
 * Parse creature stat blocks from the narrowed Monsters-section `PageText[]`.
 * Returns a `CreatureExtraction[]` sorted by name.
 */
export function parseCreatures(
  pages: readonly PageText[],
): CreatureExtraction[] {
  const flat = flatten(pages);

  // First pass: every meta-line candidate with a valid preceding name line.
  const candidates: CreatureCandidate[] = [];
  flat.forEach((entry, metaIdx) => {
    const meta = parseMetaLine(entry.line);
    if (meta === null) return;
    const nameIdx = findPrecedingNameIdx(flat, metaIdx);
    if (nameIdx === null) return;
    candidates.push({
      nameIdx,
      metaIdx,
      name: flat[nameIdx].line.trim(),
      meta,
    });
  });

  // Second pass: each candidate's body runs from its meta line to the next
  // candidate's name (exclusive), or to EOF for the last candidate.
  const out: CreatureExtraction[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const next = candidates[i + 1];
    const bodyEnd = next?.nameIdx ?? flat.length;
    const body = flat.slice(candidate.metaIdx + 1, bodyEnd).map((f) => f.line);
    const fields = readStatBlock(body);

    // Not a creature unless the structural signature is present.
    if (
      fields.armorClass === undefined ||
      fields.hitPoints === undefined ||
      fields.abilityScores === undefined
    ) {
      continue;
    }
    // Confirmed creature: Speed and Challenge are mandatory in a real stat
    // block, so their absence is a parse error, not a non-creature.
    const sourcePage = flat[candidate.metaIdx].page;
    if (fields.speed === undefined) {
      throw new Error(
        `creature "${candidate.name}" at page ${sourcePage} is missing a Speed line`,
      );
    }
    if (fields.challengeRating === undefined) {
      throw new Error(
        `creature "${candidate.name}" at page ${sourcePage} is missing a Challenge line`,
      );
    }

    out.push({
      name: candidate.name,
      size: candidate.meta.size,
      type: candidate.meta.type,
      alignment: candidate.meta.alignment,
      armorClass: fields.armorClass,
      hitPoints: fields.hitPoints,
      speed: fields.speed,
      challengeRating: fields.challengeRating,
      abilityScores: fields.abilityScores,
      sourcePage,
    });
  }

  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}
