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
 * Table-boundary fail-safe: the SRD lays each class's level-progression table
 * directly inside the Proficiencies block — between e.g. "Armor:" and
 * "Weapons:" for spellcasters and the monk — with no blank line, label, or
 * block heading to bound it (eshyra-0m9.12). Left unchecked, `collectValue`
 * swallows the entire table ("The Bard Proficiency … 20th +6 Superior
 * Inspiration") and the trailing feature prose into the preceding proficiency
 * value. So a continuation run also stops at the start of that table: its
 * title line "The <ClassName>" or any of its level-row cells ("1st +2 …").
 * Classes whose table is printed after the proficiency block (Barbarian,
 * Fighter, Rogue) are unaffected — their proficiency lines are already
 * consecutive and the boundary never triggers.
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

import type {
  ClassChoiceEntry,
  ClassExtraction,
  ClassProficiencyNote,
  ClassStartingEquipment,
  PageText,
} from './types.js';

// "Hit Dice: 1d10 per fighter level" → hit die size + class name. The class
// name is captured loosely (everything up to " level") and title-cased; no SRD
// 5.1 base-class name is multi-word, but a multi-word capture survives intact.
const HIT_DICE_PATTERN = /^Hit Dice:\s*1d(\d+)\s+per\s+(.+?)\s+level\b/i;
const ARMOR_PATTERN = /^Armor:\s*(.+)$/i;
const WEAPONS_PATTERN = /^Weapons:\s*(.+)$/i;
const SAVING_THROWS_PATTERN = /^Saving Throws?:\s*(.+)$/i;
const PRIMARY_ABILITY_PATTERN = /^Primary Abilit(?:y|ies):\s*(.+)$/i;
const TOOLS_PATTERN = /^Tools?:\s*(.+)$/i;
const SKILLS_PATTERN = /^Skills?:\s*(.+)$/i;

// A labeled line ("Tools:", "Skills:", "Saving Throws:", …) or a Class-Features
// block heading ends a wrapped field's continuation run.
const FIELD_LABEL_PATTERN = /^[A-Za-z][A-Za-z ]*:/;
const BLOCK_HEADING_PATTERN =
  /^(Hit Points|Proficiencies|Equipment|Quick Build|Class Features|Spellcasting)$/i;

// A level-progression table row leads with a level ordinal cell ("1st +2 …",
// "20th +6 …"); the table title is "The <ClassName>". Either starts the table
// the SRD prints inside the Proficiencies block, so either ends a continuation
// run (see the header note). A proficiency list never legitimately begins a
// wrapped line with a level ordinal or with "The <ClassName>".
const PROGRESSION_TABLE_ROW_PATTERN = /^\d{1,2}(?:st|nd|rd|th)\b/;

/** Escape regex metacharacters in a captured class name before interpolation. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when `line` begins the class's level-progression table: its title line
 * "The <className>" or a level-row cell. `className` is the name parsed from the
 * Hit Dice signature line, which equals the SRD table title noun.
 */
function isProgressionTableStart(line: string, className: string): boolean {
  if (PROGRESSION_TABLE_ROW_PATTERN.test(line)) return true;
  return new RegExp(`^The\\s+${escapeRegExp(className)}\\b`, 'i').test(line);
}

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

// Sticky list-delimiter pattern: a comma (with surrounding whitespace) or a
// whitespace-bounded "and"/"or" conjunction. Applied only at parenthesis depth
// 0 by `splitList` so a conjunction *inside* a parenthetical is never a split.
const LIST_DELIMITER_PATTERN = /\s*,\s*|\s+and\s+|\s+or\s+/iy;

/**
 * Split an SRD list value into its members. SRD list lines combine commas with
 * a trailing "and"/"or" conjunction ("Strength, Constitution",
 * "Strength or Dexterity", "Simple weapons, martial weapons"), so split on all
 * three and drop empties / a trailing period.
 *
 * Parenthesis-aware: a delimiter is honored only at parenthesis depth 0, so a
 * parenthetical qualifier that itself contains a conjunction or comma stays a
 * single intact token. The Druid's armor proficiency
 * "shields (druids will not wear armor or use shields made of metal)" is one
 * member, not split at the "or" inside the parentheses (eshyra-0m9.12 review).
 */
function splitList(value: string): string[] {
  const text = value.trim().replace(/\.\s*$/, '');
  const segments: string[] = [];
  let depth = 0;
  let segmentStart = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '(') {
      depth++;
      i++;
      continue;
    }
    if (ch === ')') {
      if (depth > 0) depth--;
      i++;
      continue;
    }
    if (depth === 0) {
      LIST_DELIMITER_PATTERN.lastIndex = i;
      const match = LIST_DELIMITER_PATTERN.exec(text);
      if (match !== null) {
        segments.push(text.slice(segmentStart, i));
        i += match[0].length;
        segmentStart = i;
        continue;
      }
    }
    i++;
  }
  segments.push(text.slice(segmentStart));
  return segments
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

// Number words the SRD uses for choice counts ("Choose two from …", "Three
// musical instruments of your choice").
const COUNT_WORDS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};

/** First spelled-out count word in `text`, or undefined. */
function leadingChoiceCount(text: string): number | undefined {
  for (const word of text.toLowerCase().split(/[^a-z]+/)) {
    if (word in COUNT_WORDS) return COUNT_WORDS[word];
  }
  return undefined;
}

/**
 * Extract a trailing parenthetical restriction from a normalized proficiency
 * token (eshyra-4a7.6). The Druid's "shields (druids will not wear armor or use
 * shields made of metal)" becomes the clean token "shields" plus the note text;
 * a token without a trailing "(...)" is returned unchanged with no note. Kept
 * generic so it is a no-op for the common case and never mangles a token whose
 * parenthesis is not trailing.
 */
function extractTrailingNote(token: string): {
  readonly token: string;
  readonly note?: string;
} {
  const match = /^(.*\S)\s*\(([^()]+)\)$/.exec(token.trim());
  if (match === null) return { token: token.trim() };
  return { token: match[1].trim(), note: match[2].trim() };
}

/**
 * Normalize a proficiency list, lifting any trailing parenthetical restriction
 * off each token into `proficiencyNotes` under `field`. Returns the clean
 * tokens and the collected notes (empty when none).
 */
function normalizeProficiencyList(
  tokens: readonly string[],
  field: string,
): { readonly tokens: string[]; readonly notes: ClassProficiencyNote[] } {
  const clean: string[] = [];
  const notes: ClassProficiencyNote[] = [];
  for (const raw of tokens) {
    const { token, note } = extractTrailingNote(raw);
    clean.push(token);
    if (note !== undefined) notes.push({ field, text: note });
  }
  return { tokens: clean, notes };
}

/**
 * Parse the "Skills:" value into a single source-backed choice entry. The
 * verbatim `text` is always kept; `choose` (count) and `from` (the option list)
 * are parsed when the shape is recognized, and the Bard's "Choose any three"
 * sets `any: true` with no list.
 */
function parseSkillChoice(value: string): ClassChoiceEntry {
  const text = value.trim().replace(/\.\s*$/, '');
  const fromMatch = /^choose\s+(\w+)\s+(?:skills?\s+)?from\s+(.+)$/i.exec(text);
  if (fromMatch !== null) {
    const entry: ClassChoiceEntry = { text };
    const choose = leadingChoiceCount(fromMatch[1]);
    // Strip the Oxford-comma conjunction off the final option ("…, and
    // Survival" -> "Survival"); splitList breaks on the comma first, leaving
    // the leading "and"/"or" on the last token.
    const from = splitList(fromMatch[2]).map((s) =>
      s.replace(/^(?:and|or)\s+/i, ''),
    );
    return { ...entry, ...(choose !== undefined ? { choose } : {}), from };
  }
  const anyMatch = /^choose\s+any\s+(\w+)$/i.exec(text);
  if (anyMatch !== null) {
    const choose = leadingChoiceCount(anyMatch[1]);
    return { text, any: true, ...(choose !== undefined ? { choose } : {}) };
  }
  return { text };
}

/**
 * Parse the "Tools:" value. "None" yields a fixed empty grant; a choice grant
 * ("Three musical instruments of your choice", "Choose one type of artisan's
 * tools or one musical instrument") is preserved verbatim in a choice entry;
 * any other value is a fixed grant list (e.g. "Herbalism kit").
 */
function parseToolsValue(value: string): {
  readonly toolProficiencies?: readonly string[];
  readonly toolProficiencyChoices?: readonly ClassChoiceEntry[];
} {
  const text = value.trim().replace(/\.\s*$/, '');
  if (/^none$/i.test(text)) return { toolProficiencies: [] };
  if (/\bchoose\b|of your choice/i.test(text)) {
    const choose = leadingChoiceCount(text);
    return {
      toolProficiencyChoices: [
        { text, ...(choose !== undefined ? { choose } : {}) },
      ],
    };
  }
  return { toolProficiencies: splitList(text) };
}

/**
 * Collect the class's Equipment block (eshyra-4a7.6): the intro sentence plus
 * the "(a) … or (b) …" option bullets under the "Equipment" heading, stopping
 * before the level-progression table or the next structural heading. Bullets
 * are re-joined across wrapped continuation lines; `text` keeps the whole block
 * re-flowed and `entries` lists each option line (bullet marker stripped).
 */
function collectStartingEquipment(
  body: readonly string[],
  headingIdx: number,
  className: string,
): ClassStartingEquipment | undefined {
  const intro: string[] = [];
  const entries: string[] = [];
  for (let j = headingIdx + 1; j < body.length; j++) {
    const line = body[j].trim();
    if (line.length === 0) break;
    // The Equipment block is bounded by the next block heading or the
    // progression table; do NOT break on FIELD_LABEL_PATTERN — the intro
    // sentence legitimately ends in a colon ("…granted by your background:"),
    // and Tools:/Skills: already appear earlier in the block.
    if (BLOCK_HEADING_PATTERN.test(line)) break;
    if (isProgressionTableStart(line, className)) break;
    // The spellcaster/monk progression tables print a spell-slot/resource
    // sub-header right after the equipment bullets (the table caption "The
    // <Class>" appeared earlier, interleaved); those header lines are not
    // caught by isProgressionTableStart, so stop on them explicitly to keep
    // the last bullet from swallowing the table.
    if (
      /Spell Slots per Spell Level|Spell Slot Invocations/i.test(line) ||
      line === 'Features'
    ) {
      break;
    }
    const bullet = /^[•·▪-]\s*(.+)$/.exec(line);
    if (bullet !== null) {
      entries.push(bullet[1].trim());
    } else if (entries.length === 0) {
      intro.push(line); // preamble before the first bullet
    } else {
      // Wrapped continuation of the current bullet.
      entries[entries.length - 1] = `${entries[entries.length - 1]} ${line}`;
    }
  }
  if (entries.length === 0 && intro.length === 0) return undefined;
  const text = [...intro, ...entries.map((e) => `• ${e}`)].join(' ').trim();
  return entries.length > 0 ? { text, entries } : { text };
}

/**
 * Collect a labeled field's value: the captured first-line text plus any
 * following unlabeled continuation lines (a wrapped list), stopping at the next
 * labeled line, block heading, blank line, or the start of the class's
 * level-progression table (`className`). `body` lines are already
 * whitespace-normalized.
 */
function collectValue(
  body: readonly string[],
  startIdx: number,
  initial: string,
  className: string,
): string {
  const parts = [initial.trim()];
  for (let j = startIdx + 1; j < body.length; j++) {
    const line = body[j].trim();
    if (line.length === 0) break;
    if (FIELD_LABEL_PATTERN.test(line)) break;
    if (BLOCK_HEADING_PATTERN.test(line)) break;
    if (isProgressionTableStart(line, className)) break;
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
    let toolProficiencies: readonly string[] | undefined;
    let toolProficiencyChoices: readonly ClassChoiceEntry[] | undefined;
    let skillChoices: ClassChoiceEntry[] | undefined;
    let startingEquipment: ClassStartingEquipment | undefined;
    const proficiencyNotes: ClassProficiencyNote[] = [];

    for (let k = 0; k < body.length; k++) {
      const line = body[k];
      if (armor === undefined) {
        const m = ARMOR_PATTERN.exec(line);
        if (m !== null) {
          const normalized = normalizeProficiencyList(
            parseProficiencyList(collectValue(body, k, m[1], start.name)),
            'armorProficiencies',
          );
          armor = normalized.tokens;
          proficiencyNotes.push(...normalized.notes);
          continue;
        }
      }
      if (weapons === undefined) {
        const m = WEAPONS_PATTERN.exec(line);
        if (m !== null) {
          const normalized = normalizeProficiencyList(
            parseProficiencyList(collectValue(body, k, m[1], start.name)),
            'weaponProficiencies',
          );
          weapons = normalized.tokens;
          proficiencyNotes.push(...normalized.notes);
          continue;
        }
      }
      if (savingThrows === undefined) {
        const m = SAVING_THROWS_PATTERN.exec(line);
        if (m !== null) {
          savingThrows = splitList(collectValue(body, k, m[1], start.name));
          continue;
        }
      }
      if (
        toolProficiencies === undefined &&
        toolProficiencyChoices === undefined
      ) {
        const m = TOOLS_PATTERN.exec(line);
        if (m !== null) {
          const parsed = parseToolsValue(
            collectValue(body, k, m[1], start.name),
          );
          toolProficiencies = parsed.toolProficiencies;
          toolProficiencyChoices = parsed.toolProficiencyChoices;
          continue;
        }
      }
      if (skillChoices === undefined) {
        const m = SKILLS_PATTERN.exec(line);
        if (m !== null) {
          skillChoices = [
            parseSkillChoice(collectValue(body, k, m[1], start.name)),
          ];
          continue;
        }
      }
      if (startingEquipment === undefined && /^Equipment$/i.test(line)) {
        startingEquipment = collectStartingEquipment(body, k, start.name);
        continue;
      }
      if (primaryAbilities === undefined) {
        const m = PRIMARY_ABILITY_PATTERN.exec(line);
        if (m !== null) {
          primaryAbilities = splitList(collectValue(body, k, m[1], start.name));
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
      // Optional options modeling (eshyra-4a7.6) — best-effort, not fail-closed:
      // omitted when the class block carries no such line. All SRD 5.1 classes
      // print Tools/Skills/Equipment, so the emitter sees them populated.
      ...(toolProficiencies !== undefined ? { toolProficiencies } : {}),
      ...(toolProficiencyChoices !== undefined
        ? { toolProficiencyChoices }
        : {}),
      ...(skillChoices !== undefined ? { skillChoices } : {}),
      ...(startingEquipment !== undefined ? { startingEquipment } : {}),
      ...(proficiencyNotes.length > 0 ? { proficiencyNotes } : {}),
      sourcePage: start.page,
    });
  }

  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}
