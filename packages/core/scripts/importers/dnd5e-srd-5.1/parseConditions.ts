/**
 * Condition-entry parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` already narrowed to the conditions section
 * of the SRD (e.g. "Appendix A: Conditions"); output is a
 * `ConditionExtraction[]` with stable shape, sorted by name.
 *
 * Each condition is identified by an exact match against the 15 known SRD
 * condition names. Lines preceding the first match and any lines that don't
 * fit the known-name set are silently skipped — this is safe because the
 * caller is responsible for narrowing the input to the conditions section.
 *
 * Bullet-point effects use any of the common PDF-extraction bullet markers
 * (•, -, *) followed by whitespace. Lines that start with a bullet are
 * collected into `effects[]` with the marker stripped. Non-bullet, non-blank
 * lines and blank-line-separated paragraphs form the `description` text.
 *
 * Exhaustion decision: exhaustion is modeled as a single condition record
 * (not a paired `kind=table` record) whose `data.levels` carries the
 * structured level table `[{level: 1, effect: "..."}, …, {level: 6}]`.
 * Rationale: the level data is only meaningful in the context of the
 * exhaustion condition — a free-standing table record would require
 * consumers to infer the relationship by naming convention. Keeping it
 * co-located in the condition record is simpler for callers.
 *
 * Exhaustion level-table lines are recognized as `^\s*([1-6])\s+(.+)$` after
 * the table-header line (`/^(Exhaustion )?Level\s+Effect$/i`). The header is
 * consumed and not emitted. Because pdfjs-dist may extract the two-column
 * table rows as separate fragments, the parser also accepts lines of the
 * shape `^([1-6])$` (level number alone) followed by the effect on the next
 * non-blank line — the two are merged into one level entry.
 */

import type {
  ConditionExtraction,
  ExhaustionLevel,
  PageText,
} from './types.js';

export const CONDITION_NAMES = [
  'Blinded',
  'Charmed',
  'Deafened',
  'Exhaustion',
  'Frightened',
  'Grappled',
  'Incapacitated',
  'Invisible',
  'Paralyzed',
  'Petrified',
  'Poisoned',
  'Prone',
  'Restrained',
  'Stunned',
  'Unconscious',
] as const;

export type ConditionName = (typeof CONDITION_NAMES)[number];

const CONDITION_NAME_SET = new Set<string>(CONDITION_NAMES);

function isConditionName(line: string): line is ConditionName {
  return CONDITION_NAME_SET.has(line.trim());
}

// Bullet-marker patterns used by SRD PDF extraction.
const BULLET_RE = /^[•\-*]\s+/;

function isBulletLine(line: string): boolean {
  return BULLET_RE.test(line.trim());
}

function stripBullet(line: string): string {
  return line.trim().replace(BULLET_RE, '').trim();
}

// Exhaustion level-table header: "Level Effect", "Exhaustion Level Effect", etc.
const LEVEL_HEADER_RE = /^(Exhaustion\s+)?Level\s+Effect$/i;

// Exhaustion level row: "1 Disadvantage on ability checks" or just "1"
const LEVEL_ROW_RE = /^([1-6])\s+(.+)$/;
const LEVEL_DIGIT_RE = /^([1-6])$/;

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

interface ConditionEntry {
  readonly nameIdx: number;
  readonly name: ConditionName;
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
 * Parse the body lines for a single condition. Returns the structured
 * extraction: effects (bullets), description (prose), and for exhaustion, the
 * level table.
 */
function parseConditionBody(
  name: ConditionName,
  bodyLines: readonly string[],
  sourcePage: number,
): ConditionExtraction {
  const effects: string[] = [];
  const proseLines: string[] = [];
  const levels: ExhaustionLevel[] = [];

  let inLevelTable = false;
  let pendingLevel: number | undefined;
  let i = 0;

  while (i < bodyLines.length) {
    const raw = bodyLines[i];
    const trimmed = raw.trim();
    i++;

    if (trimmed.length === 0) {
      if (!inLevelTable) {
        proseLines.push('');
      }
      continue;
    }

    // Level-table header: switch into table mode.
    if (LEVEL_HEADER_RE.test(trimmed)) {
      inLevelTable = true;
      continue;
    }

    if (inLevelTable) {
      // Combined row: "1 Disadvantage on ability checks"
      const combined = LEVEL_ROW_RE.exec(trimmed);
      if (combined !== null) {
        levels.push({
          level: Number.parseInt(combined[1], 10),
          effect: combined[2].trim(),
        });
        pendingLevel = undefined;
        continue;
      }
      // Level number alone (two-column PDF extraction artifact)
      const digitOnly = LEVEL_DIGIT_RE.exec(trimmed);
      if (digitOnly !== null) {
        pendingLevel = Number.parseInt(digitOnly[1], 10);
        continue;
      }
      // Pending level: this line is the effect text for the previous digit
      if (pendingLevel !== undefined) {
        levels.push({ level: pendingLevel, effect: trimmed });
        pendingLevel = undefined;
        continue;
      }
      // If we've collected all 6 levels, exit table mode.
      if (levels.length === 6) {
        inLevelTable = false;
        proseLines.push(trimmed);
      }
      // Otherwise keep consuming; may be a header or noise row.
      continue;
    }

    // Bullet-point effect.
    if (isBulletLine(trimmed)) {
      effects.push(stripBullet(trimmed));
      continue;
    }

    // Plain prose.
    proseLines.push(trimmed);
  }

  // Build description: prose paragraphs + bullet effects (if any).
  // For bullet-only conditions the prose section is empty; the description
  // becomes the joined bullet text so the record always has a non-empty description.
  let description: string;
  if (proseLines.filter((l) => l.length > 0).length > 0) {
    description = joinParagraphs(proseLines);
    if (effects.length > 0 && description.length === 0) {
      description = effects.join(' ');
    }
  } else {
    description = effects.join(' ');
  }

  // Fallback: if description is somehow still empty, use name as placeholder
  // (should never happen with valid SRD input).
  if (description.length === 0) {
    description = name;
  }

  return {
    name,
    description,
    effects,
    ...(levels.length > 0 ? { levels } : {}),
    sourcePage,
  };
}

/**
 * Parse condition entries from the narrowed conditions-section `PageText[]`.
 * Returns a `ConditionExtraction[]` sorted by name.
 */
export function parseConditions(
  pages: readonly PageText[],
): ConditionExtraction[] {
  const flat = flatten(pages);

  // First pass: find every condition-name line.
  const entries: ConditionEntry[] = [];
  for (let i = 0; i < flat.length; i++) {
    const line = flat[i].line.trim();
    if (isConditionName(line)) {
      entries.push({ nameIdx: i, name: line as ConditionName });
    }
  }

  // Second pass: collect body for each entry.
  const out: ConditionExtraction[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const bodyStart = entry.nameIdx + 1;
    const bodyEnd = entries[i + 1]?.nameIdx ?? flat.length;
    const bodyLines = flat.slice(bodyStart, bodyEnd).map((f) => f.line);
    const sourcePage = flat[entry.nameIdx].page;
    out.push(parseConditionBody(entry.name, bodyLines, sourcePage));
  }

  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}
