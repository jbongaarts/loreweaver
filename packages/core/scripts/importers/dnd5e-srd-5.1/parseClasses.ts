/**
 * Base-class parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` already narrowed to the SRD's "Classes"
 * chapter (the orchestrator in `index.ts` narrows it via `sliceSection`);
 * output is a `ClassExtraction[]` with stable shape, sorted by name.
 *
 * Scope (ADR 0009 / loreweaver-0m9.5.2): **base classes only**. Subclasses
 * (Champion, Life domain, …) and class features (Action Surge, Rage, …) are
 * separate, addressable record kinds (`subclass`, `feature`) parsed by separate
 * beads — they are deliberately NOT extracted here.
 *
 * Detection: each base class's "Class Features" block opens with a
 * "Hit Dice: 1dN per <class> level" line. That line is the structural signature
 * of a class entry AND names the class, so the parser keys off it directly
 * rather than guessing which heading is a class name. The proficiency and
 * primary-ability fields are then read from the labeled lines that follow,
 * within the same block (first match wins, mirroring `parseCreatures`).
 *
 * Whitespace normalization: `extract.ts` joins pdfjs text items with no
 * separator and trims only the whole line, so a column-spaced source label
 * extracts with runs of internal whitespace ("Hit   Dice:",
 * "Saving   Throws:"). Every line is collapsed to single spaces before matching
 * (`normalizeLine`) so the literal-space label patterns below match the real
 * extracted shape, not just pre-normalized fixtures.
 *
 * Wrapped fields: SRD proficiency lists wrap onto unlabeled continuation lines
 * (a long weapon list spilling past the column). A matched labeled value
 * therefore absorbs following lines until the next labeled line, block heading,
 * or blank line (`collectValue`), so the list is not silently truncated at the
 * first physical line.
 *
 * Fail-closed: a confirmed class (one with a Hit Dice line) missing one of the
 * proficiency fields the `dnd5e-srd` class kindSchema requires
 * (`validateDnd5eClass`) is a genuine malformed entry, so the parser throws with
 * the class name + page rather than emit a record that can't satisfy the schema.
 * The "Armor:" value "None" (e.g. Wizard) maps to an empty proficiency array —
 * that is a valid, present field, not a missing one. Missing ALL classes is a
 * coverage failure handled by the orchestrator (`validateClassCoverage`), not
 * here.
 *
 * `primaryAbilities` is best-effort, NOT fail-closed: the SRD 5.1 "Class
 * Features" block does not print a per-class primary/key ability line — that
 * data lives in the separate Multiclassing prerequisites table. Per ADR 0007,
 * where the source does not specify a field the importer leaves it empty rather
 * than supplying a value from general knowledge, so a class with no primary-
 * ability line in its block yields `primaryAbilities: []` here. The labeled-line
 * parse below still runs so a layout that DOES carry the line (a variant SRD
 * rendering, or a homebrew pack) populates it. For the canonical SRD 5.1, the
 * empty value is filled downstream from the Multiclassing prerequisites listing:
 * `parseMulticlassing` builds a class-name → abilities map and the class emitter
 * (`classExtractionsToRecords`) merges it into `data.primaryAbilities` when this
 * parser left the field empty (loreweaver-0m9.5.19; see ADR 0009).
 */

import type { ClassExtraction, PageText } from './types.js';

// "Hit Dice: 1d10 per fighter level" → hit die size + class name. The class
// name is captured loosely (everything up to " level") and title-cased; no SRD
// 5.1 base-class name is multi-word, but a multi-word capture survives intact.
const HIT_DICE_PATTERN = /^Hit Dice:\s*1d(\d+)\s+per\s+(.+?)\s+level\b/i;
const ARMOR_PATTERN = /^Armor:\s*(.+)$/i;
const WEAPONS_PATTERN = /^Weapons:\s*(.+)$/i;
const SAVING_THROWS_PATTERN = /^Saving Throws?:\s*(.+)$/i;
const PRIMARY_ABILITY_PATTERN = /^Primary Abilit(?:y|ies):\s*(.+)$/i;

// A labeled line ("Tools:", "Skills:", "Saving Throws:", …) or a Class-Features
// block heading ends a wrapped field's continuation run.
const FIELD_LABEL_PATTERN = /^[A-Za-z][A-Za-z ]*:/;
const BLOCK_HEADING_PATTERN =
  /^(Hit Points|Proficiencies|Equipment|Quick Build|Class Features|Spellcasting)$/i;

interface FlatLine {
  readonly line: string;
  readonly page: number;
}

/** Collapse internal whitespace runs to single spaces and trim. */
function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function flatten(pages: readonly PageText[]): readonly FlatLine[] {
  const out: FlatLine[] = [];
  for (const page of pages) {
    for (const line of page.lines) {
      out.push({ line: normalizeLine(line), page: page.pageNumber });
    }
  }
  return out;
}

/**
 * Split an SRD list value into its members. SRD list lines combine commas with
 * a trailing "and"/"or" conjunction ("Strength, Constitution",
 * "Strength or Dexterity", "Simple weapons, martial weapons"), so split on all
 * three and drop empties / a trailing period.
 */
function splitList(value: string): string[] {
  return value
    .trim()
    .replace(/\.\s*$/, '')
    .split(/\s*,\s*|\s+and\s+|\s+or\s+/i)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

/**
 * Parse a proficiency list value. The SRD prints "None" for classes with no
 * proficiency in a category (e.g. a wizard's armor); normalize that to an empty
 * array so the record carries "no proficiencies" rather than the literal token.
 */
function parseProficiencyList(value: string): string[] {
  if (/^none\.?$/i.test(value.trim())) {
    return [];
  }
  return splitList(value);
}

/**
 * Collect a labeled field's value: the captured first-line text plus any
 * following unlabeled continuation lines (a wrapped list), stopping at the next
 * labeled line, block heading, or blank line. `body` lines are already
 * whitespace-normalized.
 */
function collectValue(
  body: readonly string[],
  startIdx: number,
  initial: string,
): string {
  const parts = [initial.trim()];
  for (let j = startIdx + 1; j < body.length; j++) {
    const line = body[j].trim();
    if (line.length === 0) break;
    if (FIELD_LABEL_PATTERN.test(line)) break;
    if (BLOCK_HEADING_PATTERN.test(line)) break;
    parts.push(line);
  }
  return parts.join(' ');
}

function titleCase(name: string): string {
  return name.length === 0
    ? name
    : name.charAt(0).toUpperCase() + name.slice(1);
}

interface ClassStart {
  readonly idx: number;
  readonly hitDie: number;
  readonly name: string;
  readonly page: number;
}

/**
 * Parse base-class entries from the narrowed Classes-chapter `PageText[]`.
 * Returns a `ClassExtraction[]` sorted by name.
 */
export function parseClasses(pages: readonly PageText[]): ClassExtraction[] {
  const flat = flatten(pages);

  // First pass: every "Hit Dice: 1dN per <class> level" signature line marks
  // the start of one class's Class Features block.
  const starts: ClassStart[] = [];
  flat.forEach((entry, idx) => {
    const match = HIT_DICE_PATTERN.exec(entry.line);
    if (match === null) return;
    starts.push({
      idx,
      hitDie: Number.parseInt(match[1], 10),
      name: titleCase(match[2].trim()),
      page: entry.page,
    });
  });

  // Second pass: each class's block runs from its Hit Dice line to the next
  // class's Hit Dice line (exclusive), or to EOF for the last class. The labeled
  // proficiency / primary-ability lines are read from that block (first match
  // wins), each absorbing wrapped continuation lines.
  const out: ClassExtraction[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const bodyEnd = starts[i + 1]?.idx ?? flat.length;
    const body = flat.slice(start.idx + 1, bodyEnd).map((f) => f.line);

    let armor: string[] | undefined;
    let weapons: string[] | undefined;
    let savingThrows: string[] | undefined;
    let primaryAbilities: string[] | undefined;

    for (let k = 0; k < body.length; k++) {
      const line = body[k];
      if (armor === undefined) {
        const m = ARMOR_PATTERN.exec(line);
        if (m !== null) {
          armor = parseProficiencyList(collectValue(body, k, m[1]));
          continue;
        }
      }
      if (weapons === undefined) {
        const m = WEAPONS_PATTERN.exec(line);
        if (m !== null) {
          weapons = parseProficiencyList(collectValue(body, k, m[1]));
          continue;
        }
      }
      if (savingThrows === undefined) {
        const m = SAVING_THROWS_PATTERN.exec(line);
        if (m !== null) {
          savingThrows = splitList(collectValue(body, k, m[1]));
          continue;
        }
      }
      if (primaryAbilities === undefined) {
        const m = PRIMARY_ABILITY_PATTERN.exec(line);
        if (m !== null) {
          primaryAbilities = splitList(collectValue(body, k, m[1]));
        }
      }
    }

    // A confirmed class missing a required proficiency field is a malformed
    // entry (or a layout the patterns above don't yet match) — fail closed with
    // the class name + page rather than emit an invalid record.
    if (armor === undefined) {
      throw new Error(
        `class "${start.name}" at page ${start.page} is missing an Armor proficiency line`,
      );
    }
    if (weapons === undefined) {
      throw new Error(
        `class "${start.name}" at page ${start.page} is missing a Weapons proficiency line`,
      );
    }
    if (savingThrows === undefined) {
      throw new Error(
        `class "${start.name}" at page ${start.page} is missing a Saving Throws line`,
      );
    }

    out.push({
      name: start.name,
      hitDie: start.hitDie,
      // Best-effort: [] when the SRD block carries no primary-ability line (the
      // common case) per ADR 0007; see the header note.
      primaryAbilities: primaryAbilities ?? [],
      savingThrowProficiencies: savingThrows,
      armorProficiencies: armor,
      weaponProficiencies: weapons,
      sourcePage: start.page,
    });
  }

  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}
