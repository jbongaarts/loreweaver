/**
 * Rule-text parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` already narrowed to SRD core-rules
 * chapters (e.g. ability checks, adventuring, combat); output is a
 * `RuleExtraction[]` with stable shape, sorted by name.
 *
 * Rule boundaries are detected from heading-style lines that appear at
 * paragraph/page boundaries. The parser is intentionally conservative and
 * ignores obvious chapter/appendix headings.
 */

import type { PageText, RuleExtraction } from './types.js';

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

const NON_RULE_HEADINGS = new Set([
  'Using Ability Scores',
  'Adventuring',
  'Combat',
  'Spellcasting',
  'Equipment',
  'Conditions',
  'Appendix A: Conditions',
]);

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

function isRuleHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return false;
  if (/^[*-]\s/.test(trimmed)) return false;
  if (/[.:;!?]$/.test(trimmed)) return false;
  if (NON_RULE_HEADINGS.has(trimmed)) return false;
  return isHeadingCase(trimmed);
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

interface RuleEntry {
  readonly nameIdx: number;
  readonly name: string;
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

export function parseRules(pages: readonly PageText[]): RuleExtraction[] {
  const flat = flatten(pages);
  if (flat.length === 0) return [];

  const entries: RuleEntry[] = [];
  for (let i = 0; i < flat.length; i++) {
    const { line } = flat[i];
    const trimmed = line.trim();
    if (trimmed.length === 0 || isRuleHeading(trimmed) === false) continue;

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
