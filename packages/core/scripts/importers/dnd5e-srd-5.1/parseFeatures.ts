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
 * Feature-heading detection is table-driven where the source gives a table:
 * class/subclass progression rows populate grant-level anchors, and only
 * headings matching those anchors become feature records. Prose lead-ins such
 * as "At 3rd level" are a secondary fallback for subclass features whose grant
 * level is encoded directly in the body. Unanchored title-case option headings
 * inside a feature body (for example Fighting Style options) remain part of the
 * parent feature description rather than becoming records.
 *
 * Level: table anchors are the primary source. A leading clause in the body
 * ("Starting at 2nd level, …", "Beginning when you choose this archetype at
 * 3rd level, …", "At 2nd level, …") is used only when no table anchor exists.
 * A feature whose body opens with no such clause and lacks a table anchor is
 * not emitted; silently defaulting to level 1 would corrupt `data.level`.
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

// Class-block structural headings (the stat block before the feature list).
// Structural, never features.
const STRUCTURAL_HEADINGS = new Set([
  'Class Features',
  'Hit Points',
  'Proficiencies',
  'Equipment',
  'Quick Build',
  'Multiclassing',
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

const PROGRESSION_ROW =
  /^(\d{1,2})(?:st|nd|rd|th)\s+(?:(?:\+\d+|[+\u2212-]\d+)\s+)?(.+)$/;
const TRAILING_TABLE_CELL =
  /\s+(?:\d+|[-—]|\+\d+|[+\u2212-]\d+|\d+d\d+(?:\s*\([^)]*\))?)$/i;

interface FlatLine {
  readonly line: string;
  readonly page: number;
}

interface FeatureAnchor {
  readonly grantorKind: 'class' | 'subclass';
  readonly grantorName: string;
  readonly featureName: string;
  readonly level: number;
}

interface FeatureStart {
  readonly level: number;
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

function normalizeFeatureName(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function anchorKey(
  grantorKind: 'class' | 'subclass',
  grantorName: string,
  featureName: string,
): string {
  return `${grantorKind}\0${grantorName}\0${normalizeFeatureName(featureName)}`;
}

function isTableHeaderLine(line: string): boolean {
  return /^Level\b/.test(line) && /\bFeatures\b/.test(line);
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
    isTableHeaderLine(line) ||
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

function splitFeatureCell(cell: string): readonly string[] {
  return cell
    .split(/\s*,\s*/)
    .map((part) => part.replace(/\s*\([^)]*\)\s*$/g, '').trim())
    .filter((part) => part.length > 0 && !/^[-—]+$/.test(part));
}

function progressionFeaturesFromLine(
  line: string,
): { readonly level: number; readonly features: readonly string[] } | null {
  const match = PROGRESSION_ROW.exec(line);
  if (match === null) return null;

  let featureCell = match[2].trim();
  while (TRAILING_TABLE_CELL.test(featureCell)) {
    featureCell = featureCell.replace(TRAILING_TABLE_CELL, '').trim();
  }

  return {
    level: Number.parseInt(match[1], 10),
    features: splitFeatureCell(featureCell),
  };
}

function collectFeatureAnchors(
  flat: readonly FlatLine[],
): ReadonlyMap<string, FeatureAnchor> {
  const anchors = new Map<string, FeatureAnchor>();
  let currentClass: string | null = null;
  let currentSubclass: string | null = null;

  for (const { line } of flat) {
    if (PARENT_CLASS_NAMES.has(line)) {
      currentClass = line;
      currentSubclass = null;
      continue;
    }
    if (SUBCLASS_NAMES.has(line)) {
      currentSubclass = line;
      continue;
    }
    if (currentClass === null) continue;

    const parsed = progressionFeaturesFromLine(line);
    if (parsed === null) continue;

    const grantorKind = currentSubclass === null ? 'class' : 'subclass';
    const grantorName = currentSubclass ?? currentClass;
    for (const featureName of parsed.features) {
      const key = anchorKey(grantorKind, grantorName, featureName);
      if (anchors.has(key)) continue;
      anchors.set(key, {
        grantorKind,
        grantorName,
        featureName,
        level: parsed.level,
      });
    }
  }

  return anchors;
}

function anchorFor(
  anchors: ReadonlyMap<string, FeatureAnchor>,
  grantorKind: 'class' | 'subclass',
  grantorName: string,
  featureName: string,
): FeatureAnchor | undefined {
  return anchors.get(anchorKey(grantorKind, grantorName, featureName));
}

function leadingLevelFromFollowingLines(
  flat: readonly FlatLine[],
  startIdx: number,
): number | null {
  const parts: string[] = [];
  for (let i = startIdx; i < flat.length && parts.length < 3; i++) {
    const line = flat[i].line.trim();
    if (line.length === 0) continue;
    if (isStructuralLine(line)) break;
    parts.push(line);
    if (/[.?!]/.test(line)) break;
  }

  const match = LEVEL_LEAD_IN.exec(parts.join(' ').trim());
  return match === null ? null : Number.parseInt(match[1], 10);
}

function featureStartAt(
  flat: readonly FlatLine[],
  idx: number,
  grantorKind: 'class' | 'subclass',
  grantorName: string,
  anchors: ReadonlyMap<string, FeatureAnchor>,
): FeatureStart | null {
  const line = flat[idx].line;
  if (!isFeatureHeading(line)) return null;

  const anchor = anchorFor(anchors, grantorKind, grantorName, line);
  if (anchor !== undefined) {
    return { level: anchor.level };
  }

  const proseLevel = leadingLevelFromFollowingLines(flat, idx + 1);
  if (proseLevel !== null) {
    return { level: proseLevel };
  }

  return null;
}

/**
 * Parse class- and subclass-granted features from the narrowed
 * Classes-chapter `PageText[]`. Returns a `FeatureExtraction[]` sorted by name
 * then grantor.
 */
export function parseFeatures(pages: readonly PageText[]): FeatureExtraction[] {
  const flat = flatten(pages);
  if (flat.length === 0) return [];

  const anchors = collectFeatureAnchors(flat);
  const out: FeatureExtraction[] = [];
  const emittedIndexByKey = new Map<string, number>();
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
    const grantorKind = currentSubclass === null ? 'class' : 'subclass';
    const grantorName = currentSubclass ?? currentClass;
    const start = featureStartAt(flat, i, grantorKind, grantorName, anchors);
    if (start === null) continue;

    // Collect the body: every line up to the next structural anchor or the next
    // feature heading.
    const bodyLines: string[] = [];
    let j = i + 1;
    for (; j < flat.length; j++) {
      const next = flat[j].line;
      if (isStructuralLine(next)) break;
      if (featureStartAt(flat, j, grantorKind, grantorName, anchors) !== null) {
        break;
      }
      bodyLines.push(next);
    }

    const description = joinParagraphs(bodyLines);
    if (description.length === 0) {
      throw new Error(
        `feature "${line}" at page ${page} has no description text`,
      );
    }

    // A given (grantor, name) pair may legitimately have its heading repeated
    // in the source: an in-body reference table caption that re-states the
    // feature name (e.g. Cleric's "Destroy Undead" CR-threshold table), or an
    // end-of-chapter section heading that introduces a list of options (e.g.
    // Warlock's "Eldritch Invocations" with all invocation choices listed at
    // the end of the class chapter). Both legitimately belong to the original
    // feature, so when the same anchor matches twice, merge the additional
    // body into the existing record rather than emitting a duplicate that the
    // pack writer would reject as a duplicate `feature:<class>:<name>` key.
    const key = anchorKey(grantorKind, grantorName, line);
    const existingIdx = emittedIndexByKey.get(key);
    if (existingIdx !== undefined) {
      const existing = out[existingIdx];
      out[existingIdx] = {
        ...existing,
        description: `${existing.description}\n\n${description}`.trim(),
      };
      i = j - 1;
      continue;
    }

    emittedIndexByKey.set(key, out.length);
    out.push({
      name: line,
      grantorKind,
      grantorName,
      level: start.level,
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
