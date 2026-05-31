/**
 * Feature parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` already narrowed to the SRD's "Classes"
 * chapter (the same slice `parseClasses` / `parseSubclasses` consume — class
 * and subclass features are printed inside their grantor's section). Output is
 * a `FeatureExtraction[]`, sorted by name then grantor, with one entry per
 * class- or subclass-granted feature.
 *
 * Scope (ADR 0009 / loreweaver-0m9.5.18): class- and subclass-granted features
 * (Second Wind, Rage, Channel Divinity, Improved Critical, …). Base classes are
 * `class` records (loreweaver-0m9.5.2); subclasses are `subclass` records
 * (loreweaver-0m9.5.17). This parser extracts the *features* those grantors
 * confer.
 *
 * Grantor tracking: the parser walks the flattened lines maintaining the
 * current class and subclass context. A line that exactly matches a known base
 * class name (the 12 SRD parents) opens a class context and clears any subclass
 * context; a line that exactly matches a known subclass name opens a subclass
 * context within the current class. A feature is attributed to the current
 * subclass when one is open, otherwise to the current class. These are the same
 * known-name anchors `parseSubclasses` uses; only structural anchors are
 * hard-coded (ADR 0007) — every field VALUE is extracted from the source.
 *
 * Feature-heading detection mirrors the conservative heuristic in
 * `parseFeats`: a feature name is a short title-case line that is not a label
 * ("Armor:", "Hit Dice: …"), not body prose (it must not open with a common
 * sentence starter), not a structural heading the Classes chapter prints
 * (Class Features, Proficiencies, the subclass-group headings like "Martial
 * Archetypes", or a known class/subclass name), and not a table line (digits).
 * A feature is only emitted once a class context is open, so the chapter
 * heading and the leading class-name line are never promoted.
 *
 * Level: the grant level is read from a leading clause in the body
 * ("Starting at 2nd level, …", "Beginning when you choose this archetype at
 * 3rd level, …", "At 2nd level, …"). The level is taken from the FIRST clause
 * only, so a later in-body scaling mention (Rage's "At 3rd level your rage
 * damage increases …") is not mistaken for the grant level. A feature whose
 * body opens with no such clause is a 1st-level baseline feature (Second Wind,
 * Rage, …) and is recorded at level 1. See `FeatureExtraction` in `types.ts`.
 *
 * Fail-closed: a detected feature heading whose body re-flows to an empty
 * string is malformed (the feature kindSchema requires a non-empty
 * `description`), so the parser throws with the feature name + page rather than
 * emit a record that can't satisfy the schema.
 */

import { KNOWN_SUBCLASSES, PARENT_CLASS_NAMES } from './parseSubclasses.js';
import type { FeatureExtraction, PageText } from './types.js';

const SUBCLASS_NAMES = new Set(KNOWN_SUBCLASSES.map((s) => s.name));

// The 12 subclass-group headings the Classes chapter prints between a class's
// own features and its subclasses ("Martial Archetypes", "Divine Domains", …).
// They are structural headings, not features, so they must never be promoted.
const SUBCLASS_GROUP_HEADINGS = new Set([
  'Primal Paths',
  'Bardic Colleges',
  'Divine Domains',
  'Druid Circles',
  'Martial Archetypes',
  'Monastic Traditions',
  'Sacred Oaths',
  'Ranger Archetypes',
  'Roguish Archetypes',
  'Sorcerous Origins',
  'Otherworldly Patrons',
  'Arcane Traditions',
]);

// Class-block structural headings (the stat block before the feature list) and
// common class-table column headers. Structural, never features.
const STRUCTURAL_HEADINGS = new Set([
  'Class Features',
  'Hit Points',
  'Proficiencies',
  'Equipment',
  'Quick Build',
  'Multiclassing',
  'Level',
  'Features',
  'Proficiency Bonus',
]);

// Body-prose sentence starters: a candidate heading that opens with one of
// these is description text, not a feature name. Mirrors `parseFeats`, extended
// with the level-clause and list openers the Classes chapter uses.
const PROSE_STARTER =
  /^(You|When|While|If|As|Once|The|This|These|Each|At|Your|For|To|In|On|By|With|Through|Beginning|Starting|Whenever|Choose|Additionally|Also|A|An|Whether|After|Before|During|Until|Unless|Roll|Make|Add|Of|Their|They|From|Different)\b/;

// Grant-level clause at the START of a feature body. The level is captured from
// the first such clause only. "fighter level" / "your barbarian level" do not
// match because no digit+ordinal precedes "level".
const LEVEL_LEAD_IN =
  /^(?:Beginning|Starting|When you reach|When you choose|At)\b[^.]*?\b(\d{1,2})(?:st|nd|rd|th)\s+level\b/i;

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
 * Is `line` a known structural anchor (class name, subclass name, subclass-
 * group heading, or class-block / table heading)? Such lines bound a feature
 * body and are never themselves features.
 */
function isStructuralLine(line: string): boolean {
  return (
    PARENT_CLASS_NAMES.has(line) ||
    SUBCLASS_NAMES.has(line) ||
    SUBCLASS_GROUP_HEADINGS.has(line) ||
    STRUCTURAL_HEADINGS.has(line)
  );
}

/**
 * Heuristic: a feature name is a short (<= 50 char) title-case line that is not
 * a label, not body prose, not a structural anchor, and carries no digits
 * (table rows / "Hit Points at 1st Level" are excluded). Letters, spaces,
 * apostrophes, hyphens, slashes, and parens are allowed in names.
 */
function isFeatureHeading(line: string): boolean {
  if (line.length === 0 || line.length > 50) return false;
  if (/[:.;,]/.test(line)) return false; // labels / sentence punctuation
  if (/\d/.test(line)) return false; // table rows, level lines
  if (PROSE_STARTER.test(line)) return false;
  if (isStructuralLine(line)) return false;
  return /^[A-Z][A-Za-z '\-/()]+$/.test(line);
}

/** Extract the grant level from a feature body; defaults to 1. */
function levelOf(description: string): number {
  const match = LEVEL_LEAD_IN.exec(description.trim());
  return match === null ? 1 : Number.parseInt(match[1], 10);
}

/**
 * Parse class- and subclass-granted features from the narrowed
 * Classes-chapter `PageText[]`. Returns a `FeatureExtraction[]` sorted by name
 * then grantor.
 */
export function parseFeatures(pages: readonly PageText[]): FeatureExtraction[] {
  const flat = flatten(pages);
  if (flat.length === 0) return [];

  const out: FeatureExtraction[] = [];
  let currentClass: string | null = null;
  let currentSubclass: string | null = null;

  for (let i = 0; i < flat.length; i++) {
    const { line, page } = flat[i];

    // Known-name anchors update grantor context and are not themselves features.
    if (PARENT_CLASS_NAMES.has(line)) {
      currentClass = line;
      currentSubclass = null;
      continue;
    }
    if (SUBCLASS_NAMES.has(line)) {
      currentSubclass = line;
      continue;
    }
    if (isStructuralLine(line)) continue;

    // Features only exist once a class context is open (so the chapter heading
    // and pre-class prose are never promoted).
    if (currentClass === null) continue;
    if (!isFeatureHeading(line)) continue;

    // Collect the body: every line up to the next structural anchor or the next
    // feature heading.
    const bodyLines: string[] = [];
    let j = i + 1;
    for (; j < flat.length; j++) {
      const next = flat[j].line;
      if (isStructuralLine(next) || isFeatureHeading(next)) break;
      bodyLines.push(next);
    }

    const description = joinParagraphs(bodyLines);
    if (description.length === 0) {
      throw new Error(
        `feature "${line}" at page ${page} has no description text`,
      );
    }

    out.push({
      name: line,
      grantorKind: currentSubclass === null ? 'class' : 'subclass',
      grantorName: currentSubclass ?? currentClass,
      level: levelOf(description),
      description,
      sourcePage: page,
    });

    // Resume scanning from the line after the body (j is the boundary line, so
    // -1 keeps it for the next iteration's anchor/heading handling).
    i = j - 1;
  }

  out.sort((a, b) => {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.grantorName < b.grantorName
      ? -1
      : a.grantorName > b.grantorName
        ? 1
        : 0;
  });
  return out;
}
