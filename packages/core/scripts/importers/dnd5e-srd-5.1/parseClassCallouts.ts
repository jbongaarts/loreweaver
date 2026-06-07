import {
  hasHeadingTiers,
  isCalloutBoxHeading,
  isParentClassHeading,
} from './parseSubclasses.js';
import type { PageText, RuleExtraction } from './types.js';

interface FlatLine {
  readonly line: string;
  readonly page: number;
  readonly height?: number;
}

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function flatten(pages: readonly PageText[]): readonly FlatLine[] {
  const out: FlatLine[] = [];
  for (const page of pages) {
    for (let i = 0; i < page.lines.length; i++) {
      out.push({
        line: normalizeLine(page.lines[i]),
        page: page.pageNumber,
        height: page.lineHeights?.[i],
      });
    }
  }
  return out;
}

function joinParagraphs(lines: readonly string[]): string {
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.length === 0) {
      if (current.length > 0) {
        paragraphs.push(current.join(' '));
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) paragraphs.push(current.join(' '));
  return paragraphs.join('\n\n');
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function parseClassCallouts(
  pages: readonly PageText[],
): RuleExtraction[] {
  const flat = flatten(pages);
  const tiersPresent = hasHeadingTiers(flat.map(({ height }) => height));
  if (!tiersPresent) return [];

  const rules: RuleExtraction[] = [];
  let currentClass: string | undefined;

  for (let i = 0; i < flat.length; i++) {
    const heading = flat[i];
    const headingHeight = heading.height;
    if (isParentClassHeading(heading.line, headingHeight, tiersPresent)) {
      currentClass = heading.line;
      continue;
    }
    if (
      currentClass === undefined ||
      headingHeight === undefined ||
      !isCalloutBoxHeading(headingHeight)
    ) {
      continue;
    }

    const body: string[] = [];
    let next = i + 1;
    while (next < flat.length) {
      const line = flat[next];
      if (line.height !== undefined && line.height >= headingHeight) break;
      body.push(line.line);
      next++;
    }

    const text = joinParagraphs(body);
    if (text.length > 0) {
      rules.push({
        name: heading.line,
        keySlug: `${slug(currentClass)}-${slug(heading.line)}`,
        text,
        sourcePage: heading.page,
      });
    }
    i = next - 1;
  }

  rules.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return rules;
}
