/**
 * Base-class parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` already narrowed to the SRD's "Classes"
 * chapter (the orchestrator in `index.ts` narrows it via `sliceSection`);
 * output is a `ClassExtraction[]` with stable shape, sorted by name.
 *
 * Scope (ADR 0008 / loreweaver-0m9.5.2): **base classes only**. Subclasses
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
 * Fail-closed: a confirmed class (one with a Hit Dice line) missing one of the
 * proficiency fields the `dnd5e-srd` class kindSchema requires
 * (`validateDnd5eClass`) is a genuine malformed entry, so the parser throws with
 * the class name + page rather than emit a record that can't satisfy the schema.
 * The "Armor:" value "None" (e.g. Wizard) maps to an empty proficiency array —
 * that is a valid, present field, not a missing one.
 *
 * `primaryAbilities` is best-effort, NOT fail-closed: the SRD 5.1 "Class
 * Features" block does not print a per-class primary/key ability line — that
 * data lives in the separate Multiclassing prerequisites table. Per ADR 0007,
 * where the source does not specify a field the importer leaves it empty rather
 * than supplying a value from general knowledge, so a class with no primary-
 * ability line in its block yields `primaryAbilities: []`. The labeled-line
 * parse below still runs so a layout that DOES carry the line (a variant SRD
 * rendering, or a homebrew pack) populates it. Cross-referencing the
 * Multiclassing prerequisites table to fill this field is tracked as a separate
 * normalization-mapping bead (see ADR 0008 / loreweaver-0m9.5.2 notes).
 *
 * Real-PDF note: like the section anchors in `sections.ts`, the labeled-line
 * patterns below target the SRD 5.1 layout and must be confirmed once the PDF
 * is vendored.
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
    const match = HIT_DICE_PATTERN.exec(entry.line.trim());
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
  // proficiency / primary-ability lines are read from that block, first match
  // wins.
  const out: ClassExtraction[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const bodyEnd = starts[i + 1]?.idx ?? flat.length;
    const body = flat.slice(start.idx + 1, bodyEnd).map((f) => f.line);

    let armor: string[] | undefined;
    let weapons: string[] | undefined;
    let savingThrows: string[] | undefined;
    let primaryAbilities: string[] | undefined;

    for (const raw of body) {
      const line = raw.trim();
      if (armor === undefined) {
        const m = ARMOR_PATTERN.exec(line);
        if (m !== null) {
          armor = parseProficiencyList(m[1]);
          continue;
        }
      }
      if (weapons === undefined) {
        const m = WEAPONS_PATTERN.exec(line);
        if (m !== null) {
          weapons = parseProficiencyList(m[1]);
          continue;
        }
      }
      if (savingThrows === undefined) {
        const m = SAVING_THROWS_PATTERN.exec(line);
        if (m !== null) {
          savingThrows = splitList(m[1]);
          continue;
        }
      }
      if (primaryAbilities === undefined) {
        const m = PRIMARY_ABILITY_PATTERN.exec(line);
        if (m !== null) {
          primaryAbilities = splitList(m[1]);
        }
      }
    }

    // A confirmed class missing any kindSchema-required field is a malformed
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
