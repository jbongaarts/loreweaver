/**
 * Rule-text parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` already narrowed to SRD core-rules
 * chapters (Using Ability Scores, Adventuring, Combat); output is a
 * `RuleExtraction[]` with stable shape, sorted by name.
 *
 * Two parsing paths (loreweaver-yli):
 *
 *  1. **Heading-hierarchy path** — used when the slice carries per-line font
 *     heights (`PageText.lineHeights`, the real SRD extraction). The SRD core
 *     rules nest four font tiers: chapter (h≈25.9, rendered as a rotated page
 *     banner that pdfjs drops from the slice), subsection (h≈18, e.g. "Making
 *     an Attack"), sub-subsection (h≈13.9, e.g. "Attack Rolls"), and leaf
 *     (h≈12, e.g. "Death Saving Throws"). The parser emits a rule per heading
 *     and bounds each body at the NEXT heading of ANY tier, so a parent keeps
 *     only its intro prose and every child becomes its own record (no
 *     wrapper-drop, no parent→child body-bleed). Cross-chapter name collisions
 *     ("Hit Points" in both Constitution and Damage and Healing; "Initiative"
 *     in Dexterity and The Order of Combat; the three per-ability "Spellcasting
 *     Ability" sidebars) are disambiguated with parent-qualified record keys —
 *     the leaf `name` stays the SRD title, but `keySlug` prepends just enough
 *     ancestor titles to stay unique.
 *
 *  2. **Legacy text-heuristic path** — used when the slice has NO font heights
 *     (fixture PDFs built at a uniform size). Heading boundaries are detected
 *     from heading-cased lines at paragraph/page boundaries, a flat (un-nested)
 *     emission. This preserves the original behavior the fixture unit tests
 *     assert against.
 */

import type { PageText, RuleExtraction } from './types.js';

interface FlatLine {
  readonly line: string;
  readonly page: number;
  /** Rendered max font height for this line, when the source carried it. */
  readonly height?: number;
}

function flatten(pages: readonly PageText[]): FlatLine[] {
  const out: FlatLine[] = [];
  for (const page of pages) {
    const heights = page.lineHeights;
    for (let i = 0; i < page.lines.length; i++) {
      out.push({
        line: page.lines[i],
        page: page.pageNumber,
        height: heights?.[i],
      });
    }
  }
  return out;
}

const CONNECTOR_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

function normalizeToken(token: string): string {
  return token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
}

function isHeadingCase(line: string): boolean {
  const tokens = line
    .split(/\s+/)
    .map((t) => normalizeToken(t))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return false;
  let hasCapitalizedContent = false;
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (CONNECTOR_WORDS.has(lower)) {
      continue;
    }
    if (/^\d+$/.test(token)) {
      hasCapitalizedContent = true;
      continue;
    }
    if (/^[A-Z][A-Za-z0-9'/-]*$/.test(token)) {
      hasCapitalizedContent = true;
      continue;
    }
    return false;
  }
  return hasCapitalizedContent;
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

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Heading-hierarchy path (real SRD extraction with per-line font heights)
// ---------------------------------------------------------------------------

/**
 * Font-height tier bands (PDF user-space points). SRD 5.1 core-rules headings
 * render in a single heading font (`g_d0_f2`) at chapter h≈25.9, subsection
 * h≈18.0, sub-subsection h≈13.9, leaf h≈12.0, and — in the gray callout boxes
 * (Hiding, Combat Step by Step, Interacting with Objects Around You, Contests
 * in Combat) — a sidebar size h≈10.8. Body prose renders at h≈9.8 and sidebar
 * body at h≈8.9, so `SIDEBAR_MIN_H` sits in the gap above both. Capturing the
 * h≈10.8 box tier is load-bearing: without it the box heading is treated as
 * body and its whole rule (e.g. the Hiding / Stealth rules) is swallowed into
 * the preceding record's body (the corruption that buried Hiding under the
 * Dexterity "Initiative" sidebar). A line below `SIDEBAR_MIN_H` is body.
 */
const SIDEBAR_MIN_H = 10.3;
const LEAF_MIN_H = 11.5;
const SUBSUB_MIN_H = 13;
const SUB_MIN_H = 16;
const CHAPTER_MIN_H = 20;

/**
 * Heading tier for a line height. 1 = subsection, 2 = sub-subsection, 3 = leaf,
 * 4 = sidebar/callout box (all rule-emitting); 0 = chapter (a structural
 * wrapper, never emitted but kept as an ancestor); -1 = body prose. Larger
 * height ⇒ shallower tier. The h≈10.8 sidebar tier is the deepest, so a box
 * heading is always popped from the ancestor stack by any following real
 * heading and never parents main-flow content.
 */
function headingTier(height: number | undefined): number {
  if (height === undefined) return -1;
  if (height >= CHAPTER_MIN_H) return 0;
  if (height >= SUB_MIN_H) return 1;
  if (height >= SUBSUB_MIN_H) return 2;
  if (height >= LEAF_MIN_H) return 3;
  if (height >= SIDEBAR_MIN_H) return 4;
  return -1;
}

function endsWithConnector(text: string): boolean {
  const tokens = text.trim().split(/\s+/);
  const last = normalizeToken(tokens[tokens.length - 1] ?? '').toLowerCase();
  return CONNECTOR_WORDS.has(last) || text.trim().endsWith('&');
}

interface TieredLine extends FlatLine {
  readonly tier: number;
}

/**
 * Merge a heading that wraps across two visual rows back into one line. SRD 5.1
 * subsection (h=18) and sub-subsection (h=13.9) titles whose text is too wide
 * for the narrow column wrap onto a second row ("Advantage and" / "Disadvantage",
 * "Damage Resistance and" / "Vulnerability"); the extractor only merges the
 * largest chapter-title tier (h≥20), so these arrive as two same-tier heading
 * lines. A wrap is recognized when the first row ends with a connector word
 * (and / or / to / of …) — sibling headings ("Short Rest" then "Long Rest")
 * never do, so they are left as separate rules.
 */
function mergeWrappedHeadings(flat: readonly FlatLine[]): TieredLine[] {
  const out: TieredLine[] = [];
  let i = 0;
  while (i < flat.length) {
    const cur = flat[i];
    const tier = headingTier(cur.height);
    if (tier >= 0 && endsWithConnector(cur.line)) {
      // Greedily absorb following same-tier heading rows until one does not
      // continue the wrap (does not end with a connector).
      let text = cur.line.trim();
      let j = i + 1;
      while (j < flat.length && headingTier(flat[j].height) === tier) {
        text = `${text} ${flat[j].line.trim()}`;
        if (endsWithConnector(flat[j].line)) {
          j++;
          continue;
        }
        j++;
        break;
      }
      if (j > i + 1) {
        out.push({ line: text, page: cur.page, height: cur.height, tier });
        i = j;
        continue;
      }
    }
    out.push({ line: cur.line, page: cur.page, height: cur.height, tier });
    i++;
  }
  return out;
}

interface HeadingEntry {
  readonly name: string;
  readonly tier: number;
  /** Ancestor heading names, outermost first. */
  readonly ancestors: readonly string[];
  readonly bodyLines: readonly string[];
  readonly page: number;
}

/**
 * True when the first prose of a heading's body is a bullet item — the
 * signature of the SRD "Skills" per-ability skill captions (the h=12
 * "Strength" → "• Athletics", "Charisma" → "• Deception …" list under Ability
 * Checks), which are list scaffolding rather than adjudication rules and also
 * collide by name with the real "Using Each Ability" sections (h=13.9). Real
 * core rules always open with prose, so a leading bullet is a reliable
 * exclusion.
 */
function bodyLeadsWithBullet(bodyLines: readonly string[]): boolean {
  for (const raw of bodyLines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    return /^[•*]\s/.test(line) || /^-\s/.test(line);
  }
  return false;
}

/**
 * Leaf (h=12) heading titles whose body the importer reconstructs as a `table`
 * record (parseTables owns the same core-rules slice), so they must not also be
 * emitted as prose `rule` records: the Ability Scores and Modifiers score table,
 * the Typical Difficulty Classes DC table, the Travel Pace table, and the
 * creature Size Categories table. Gated to the leaf tier so the same-named
 * "Ability Scores and Modifiers" h=18 subsection (a real prose rule) is kept.
 */
const TABLE_CAPTION_LEAF_TITLES = new Set([
  'Ability Scores and Modifiers',
  'Typical Difficulty Classes',
  'Travel Pace',
  'Size Categories',
]);

function isExcludedHeading(
  name: string,
  tier: number,
  bodyLines: readonly string[],
): boolean {
  const trimmed = name.trim();
  if (/^Variant\b/i.test(trimmed)) return true;
  if (tier === 3 && TABLE_CAPTION_LEAF_TITLES.has(trimmed)) return true;
  if (bodyLeadsWithBullet(bodyLines)) return true;
  return false;
}

function collectHeadingEntries(merged: readonly TieredLine[]): HeadingEntry[] {
  const entries: HeadingEntry[] = [];
  const stack: { name: string; tier: number }[] = [];
  for (let i = 0; i < merged.length; i++) {
    const cur = merged[i];
    if (cur.tier < 0) continue; // body prose
    // Pop ancestors at this tier or deeper so the stack holds strict parents.
    while (stack.length > 0 && stack[stack.length - 1].tier >= cur.tier) {
      stack.pop();
    }
    if (cur.tier === 0) {
      // Chapter wrapper: keep as ancestor context, never emit.
      stack.push({ name: cur.line.trim(), tier: cur.tier });
      continue;
    }
    const bodyLines: string[] = [];
    for (let j = i + 1; j < merged.length && merged[j].tier < 0; j++) {
      bodyLines.push(merged[j].line);
    }
    const ancestors = stack.map((s) => s.name);
    stack.push({ name: cur.line.trim(), tier: cur.tier });
    if (isExcludedHeading(cur.line, cur.tier, bodyLines)) continue;
    entries.push({
      name: cur.line.trim(),
      tier: cur.tier,
      ancestors,
      bodyLines,
      page: cur.page,
    });
  }
  return entries;
}

/**
 * Assign a unique record key slug per entry. The leaf title slug is used when
 * it is unique across the parsed set; colliding leaves (cross-chapter repeats
 * and per-ability sidebars) gain just enough nearest-ancestor titles, prepended,
 * to disambiguate — and, as a final guard against an exact path repeat, a
 * numeric suffix.
 *
 * `reserved` carries key slugs already emitted by an EARLIER `parseRules` call
 * over a sibling slice (loreweaver-3hp): the SRD 5.1 Spellcasting-rules chapter
 * is sliced and parsed separately from the core-rules chapters, but it repeats
 * a handful of titles those chapters already own ("Range" and "Attack Rolls"
 * under Making an Attack, "Saving Throws", "Reactions" under The Order of
 * Combat). A bare-slug emission would collide cross-slice and produce duplicate
 * `rule:` keys in the pack. Treating a reserved slug as an occupied slot forces
 * the colliding spellcasting entry to parent-qualify (e.g. `range` →
 * `casting-a-spell-range`) exactly as an intra-slice collision would, leaving
 * the already-reviewed core-rules keys untouched.
 */
function assignKeySlugs(
  entries: readonly HeadingEntry[],
  reserved: ReadonlySet<string>,
): string[] {
  const depths = entries.map(() => 0);
  const keyAt = (idx: number): string => {
    const e = entries[idx];
    const depth = depths[idx];
    if (depth === 0) return slug(e.name);
    const prefix = e.ancestors.slice(Math.max(0, e.ancestors.length - depth));
    return slug([...prefix, e.name].join(' '));
  };
  // Increase qualification depth on any colliding group until keys are unique
  // or every member has consumed its full ancestor path. A key that matches a
  // reserved sibling-slice slug counts as a collision even when it is unique
  // within this slice, so it qualifies away from the reserved key.
  for (let guard = 0; guard < 64; guard++) {
    const byKey = new Map<string, number[]>();
    for (let i = 0; i < entries.length; i++) {
      const k = keyAt(i);
      const bucket = byKey.get(k);
      if (bucket === undefined) byKey.set(k, [i]);
      else bucket.push(i);
    }
    let changed = false;
    for (const [k, idxs] of byKey.entries()) {
      const collides = idxs.length > 1 || reserved.has(k);
      if (!collides) continue;
      for (const i of idxs) {
        if (depths[i] < entries[i].ancestors.length) {
          depths[i]++;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  // Final exact-duplicate guard: append a numeric suffix to any key that is
  // still shared after ancestors are exhausted (degenerate, shouldn't occur).
  // Reserved keys seed the used-map so a slug that could not be qualified away
  // from a reserved sibling-slice key still gains a suffix rather than colliding.
  const used = new Map<string, number>();
  for (const k of reserved) used.set(k, 1);
  return entries.map((_, i) => {
    let k = keyAt(i);
    const seen = used.get(k);
    if (seen !== undefined) {
      const next = seen + 1;
      used.set(k, next);
      k = `${k}-${next}`;
    }
    used.set(k, used.get(k) ?? 1);
    return k;
  });
}

function parseRulesByHeadings(
  flat: readonly FlatLine[],
  reserved: ReadonlySet<string>,
): RuleExtraction[] {
  const merged = mergeWrappedHeadings(flat);
  const entries = collectHeadingEntries(merged);
  if (entries.length === 0) return [];
  const keySlugs = assignKeySlugs(entries, reserved);
  const out: RuleExtraction[] = entries.map((entry, i) => {
    const text = joinParagraphs(entry.bodyLines);
    return {
      name: entry.name,
      keySlug: keySlugs[i],
      text: text.length > 0 ? text : entry.name,
      sourcePage: entry.page,
    };
  });
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

// ---------------------------------------------------------------------------
// Legacy text-heuristic path (fixture PDFs without per-line font heights)
// ---------------------------------------------------------------------------

const NON_RULE_HEADINGS = new Set([
  'Using Ability Scores',
  'Adventuring',
  'Combat',
  'Spellcasting',
  'Equipment',
  'Conditions',
  'Appendix A: Conditions',
]);

function isRuleHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return false;
  if (/^[*-]\s/.test(trimmed)) return false;
  if (/[.:;!?]$/.test(trimmed)) return false;
  if (NON_RULE_HEADINGS.has(trimmed)) return false;
  return isHeadingCase(trimmed);
}

function nextNonBlankLine(
  flat: readonly FlatLine[],
  idx: number,
): string | undefined {
  for (let i = idx + 1; i < flat.length; i++) {
    const candidate = flat[i].line.trim();
    if (candidate.length > 0) return candidate;
  }
  return undefined;
}

interface RuleEntry {
  readonly nameIdx: number;
  readonly name: string;
}

function parseRulesByHeuristic(flat: readonly FlatLine[]): RuleExtraction[] {
  const entries: RuleEntry[] = [];
  for (let i = 0; i < flat.length; i++) {
    const { line } = flat[i];
    const trimmed = line.trim();
    if (trimmed.length === 0 || isRuleHeading(trimmed) === false) continue;

    const previous = flat[i - 1]?.line.trim();
    const atSliceStart = i === 0;
    const atPageStart = i > 0 && flat[i - 1]?.page !== flat[i].page;
    const afterBlank = previous === undefined || previous.length === 0;
    if (atSliceStart === false && atPageStart === false && afterBlank === false)
      continue;

    // If the next non-blank line is also a heading, treat this as a chapter/
    // section wrapper rather than an extractable rule body.
    const next = nextNonBlankLine(flat, i);
    if (next === undefined) continue;
    if (isRuleHeading(next)) continue;

    entries.push({ nameIdx: i, name: trimmed });
  }

  if (entries.length === 0) return [];

  const out: RuleExtraction[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const bodyStart = entry.nameIdx + 1;
    const bodyEnd = entries[i + 1]?.nameIdx ?? flat.length;
    const bodyLines = flat.slice(bodyStart, bodyEnd).map((f) => f.line);
    const text = joinParagraphs(bodyLines);
    out.push({
      name: entry.name,
      text: text.length > 0 ? text : entry.name,
      sourcePage: flat[entry.nameIdx].page,
    });
  }

  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

/**
 * Parse a core-rules-style slice into `rule` records.
 *
 * `reservedKeySlugs` (loreweaver-3hp) lets a second slice be parsed against the
 * key slugs an earlier slice already emitted, so cross-slice title repeats
 * disambiguate by parent-qualified key instead of producing duplicate `rule:`
 * keys. The SRD 5.1 importer parses the core-rules chapters first, then parses
 * the separate Spellcasting-rules chapter with those core keys reserved. Only
 * the heading-hierarchy path honors it; the legacy fixture heuristic does not
 * assign key slugs.
 */
export function parseRules(
  pages: readonly PageText[],
  reservedKeySlugs: ReadonlySet<string> = new Set(),
): RuleExtraction[] {
  const flat = flatten(pages);
  if (flat.length === 0) return [];
  // Use the font-height hierarchy only when the slice carries the SRD's
  // genuine multi-tier font structure: at least one line at a real heading
  // height (≥ LEAF_MIN_H) AND more than one distinct height present.
  // Uniform-font fixture PDFs render every line at a single body size, so they
  // fail the distinct-height test and fall back to the text heuristic the
  // fixture unit/pipeline tests assert against — even though that single size
  // may sit inside a heading band.
  const definedHeights = flat
    .map((f) => f.height)
    .filter((h): h is number => h !== undefined);
  const distinctHeights = new Set(definedHeights);
  const hasHeadingTiers =
    distinctHeights.size > 1 && definedHeights.some((h) => h >= LEAF_MIN_H);
  return hasHeadingTiers
    ? parseRulesByHeadings(flat, reservedKeySlugs)
    : parseRulesByHeuristic(flat);
}
