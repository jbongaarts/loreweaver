/**
 * Magic-item parser for the D&D 5e SRD 5.1 importer.
 *
 * Input is a slice of `PageText[]` already narrowed to the "Magic Items A-Z"
 * subsection. Each item is introduced by one or more title lines followed by a
 * category / rarity line, for example:
 *
 *   Adamantine Armor
 *   Armor (medium or heavy, but not hide), uncommon
 *
 * The parser deliberately keeps embedded item tables inside `description`
 * text. The A-Z tables are item-specific mechanics, not freestanding reference
 * tables, and preserving them in the parent item avoids inventing linked table
 * semantics not present elsewhere in the pack.
 */

import type { MagicItemExtraction, PageText } from './types.js';

interface FlatLine {
  readonly line: string;
  readonly page: number;
}

interface EntryAnchor {
  readonly nameStart: number;
  readonly categoryStart: number;
  readonly categoryEnd: number;
  readonly name: string;
  readonly itemType: string;
  readonly rarity: string;
  readonly requiresAttunement: boolean;
  readonly attunementRequirement?: string;
}

interface CategorySpan {
  readonly end: number;
  readonly lines: readonly string[];
}

const ITEM_TYPE_PREFIX =
  /^(Armor|Potion|Ring|Rod|Scroll|Staff|Wand|Weapon|Wondrous item)\b/;
const ITEM_TYPE_WORD =
  /\b(Armor|Potion|Ring|Rod|Scroll|Staff|Wand|Weapon|Wondrous item)\b/gi;

const RARITY_WORD =
  /\b(common|uncommon|rare|very rare|legendary|artifact|rarity varies|varies)\b/i;

const BODY_LABEL_PREFIX =
  /^(Actions|Armor Class|Challenge|Condition Immunities|Damage Immunities|Hit Points|Languages|Senses|Speed|STR DEX CON INT WIS CHA)\b/i;

const WRAPPED_TITLE_CONNECTOR =
  /(?:^|\s)(a|an|and|against|by|for|from|in|of|on|or|the|to|with|without)$/i;

const DAMAGE_TYPE_WORD =
  /\b(acid|cold|fire|force|lightning|necrotic|poison|psychic|radiant|thunder)\b/gi;

function flatten(pages: readonly PageText[]): readonly FlatLine[] {
  const out: FlatLine[] = [];
  for (const page of pages) {
    for (const line of page.lines) {
      out.push({ line, page: page.pageNumber });
    }
  }
  return out;
}

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

function normalizeSpaces(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function categoryTextFromLine(line: string): string | undefined {
  const text = line.trim();
  for (const match of text.matchAll(ITEM_TYPE_WORD)) {
    const index = match.index ?? 0;
    const candidate = text.slice(index);
    if (ITEM_TYPE_PREFIX.test(candidate) && RARITY_WORD.test(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function isCategoryStart(line: string): boolean {
  return categoryTextFromLine(line) !== undefined;
}

function hasUnclosedParen(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')' && depth > 0) depth--;
  }
  return depth > 0;
}

function isCategoryContinuation(line: string): boolean {
  const text = line.trim();
  return (
    text.startsWith('(') ||
    /^(or\s+)?(common|uncommon|rare|very rare|legendary|artifact|rarity varies|varies)\b/i.test(
      text,
    ) ||
    /^(attunement|warlock|wizard|druid|cleric|paladin|sorcerer)\b/i.test(text)
  );
}

function categorySpan(
  flat: readonly FlatLine[],
  categoryStart: number,
): CategorySpan {
  const firstLine = categoryTextFromLine(flat[categoryStart].line);
  if (firstLine === undefined) {
    throw new Error('categorySpan called for a non-category line');
  }
  let end = categoryStart;
  const lines = [firstLine];
  let text = firstLine;
  while (end + 1 < flat.length) {
    const next = flat[end + 1].line.trim();
    if (categoryTextFromLine(next) !== undefined) break;
    if (hasUnclosedParen(text)) {
      if (isCategoryContinuation(next)) {
        end++;
        lines.push(next);
        text = `${text} ${next}`;
        continue;
      }
      if (
        end + 2 < flat.length &&
        isSkippableInterleavedBodyLine(next) &&
        isCategoryContinuation(flat[end + 2].line)
      ) {
        end++;
        continue;
      }
      break;
    }
    if (isCategoryContinuation(next)) {
      end++;
      lines.push(next);
      text = `${text} ${next}`;
      continue;
    }
    break;
  }
  return { end, lines };
}

function hasOrdinaryNumber(text: string): boolean {
  return /(^|[^+\w])\d/.test(text);
}

function hasMultipleDamageTypes(text: string): boolean {
  if (/\bof\b/i.test(text)) return false;
  const matches = text.match(DAMAGE_TYPE_WORD);
  return matches !== null && matches.length >= 2;
}

function endsWithLowercaseNonConnector(text: string): boolean {
  if (!/[A-Za-z]$/.test(text)) return false;
  const words = text.match(/[A-Za-z]+/g);
  const last = words?.at(-1);
  return (
    last !== undefined &&
    /^[a-z]/.test(last) &&
    !WRAPPED_TITLE_CONNECTOR.test(text)
  );
}

function isSkippableInterleavedBodyLine(line: string): boolean {
  const text = line.trim();
  return (
    text.length === 0 ||
    text.startsWith('•') ||
    /^[a-z]/.test(text) ||
    BODY_LABEL_PREFIX.test(text) ||
    hasOrdinaryNumber(text) ||
    hasMultipleDamageTypes(text) ||
    endsWithLowercaseNonConnector(text)
  );
}

function looksLikeNameLine(line: string): boolean {
  const text = line.trim();
  if (text.length === 0) return false;
  if (/[.!?:]$/.test(text)) return false;
  if (/^[a-z]/.test(text)) return false;
  if (text.startsWith('•')) return false;
  if (BODY_LABEL_PREFIX.test(text)) return false;
  if (hasOrdinaryNumber(text)) return false;
  if (hasMultipleDamageTypes(text)) return false;
  if (endsWithLowercaseNonConnector(text)) return false;
  if (ITEM_TYPE_PREFIX.test(text) && RARITY_WORD.test(text)) return false;
  return true;
}

function shouldJoinWrappedNameLine(line: string): boolean {
  const text = line.trim();
  return (
    looksLikeNameLine(text) &&
    (WRAPPED_TITLE_CONNECTOR.test(text) || /[,(-]$/.test(text))
  );
}

function nameStartIndex(
  flat: readonly FlatLine[],
  categoryStart: number,
): number | undefined {
  let start = categoryStart - 1;
  let skipped = 0;
  while (
    start >= 0 &&
    skipped < 4 &&
    isSkippableInterleavedBodyLine(flat[start].line)
  ) {
    start--;
    skipped++;
  }
  if (start < 0 || !looksLikeNameLine(flat[start].line)) return undefined;
  while (start - 1 >= 0 && shouldJoinWrappedNameLine(flat[start - 1].line)) {
    start--;
  }
  return start;
}

function parseCategory(
  text: string,
): Omit<EntryAnchor, 'nameStart' | 'categoryStart' | 'categoryEnd' | 'name'> {
  const withoutAttunement = text.replace(
    /\s*\((requires attunement[^)]*)\)/i,
    '',
  );
  const attunementMatch = /\((requires attunement[^)]*)\)/i.exec(text);
  const requiresAttunement = attunementMatch !== null;
  const attunementText = attunementMatch?.[1]
    .replace(/^requires attunement\s*/i, '')
    .trim();
  const comma = firstTopLevelComma(withoutAttunement);
  const itemType =
    comma === -1 ? withoutAttunement.trim() : withoutAttunement.slice(0, comma);
  const rarity = comma === -1 ? '' : withoutAttunement.slice(comma + 1).trim();
  return {
    itemType: normalizeSpaces(itemType),
    rarity: normalizeSpaces(rarity.replace(/\s*,\s*$/, '')),
    requiresAttunement,
    ...(attunementText === undefined || attunementText.length === 0
      ? {}
      : { attunementRequirement: normalizeSpaces(attunementText) }),
  };
}

function firstTopLevelComma(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    if (ch === ')' && depth > 0) depth--;
    if (ch === ',' && depth === 0) return i;
  }
  return -1;
}

function findEntries(flat: readonly FlatLine[]): readonly EntryAnchor[] {
  const entries: EntryAnchor[] = [];
  for (let i = 0; i < flat.length; i++) {
    if (!isCategoryStart(flat[i].line)) continue;
    const start = nameStartIndex(flat, i);
    if (start === undefined) continue;
    const category = categorySpan(flat, i);
    const end = category.end;
    const categoryText = normalizeSpaces(
      category.lines.map((line) => line.trim()).join(' '),
    );
    entries.push({
      nameStart: start,
      categoryStart: i,
      categoryEnd: end,
      name: normalizeSpaces(
        flat
          .slice(start, i)
          .filter((f) => looksLikeNameLine(f.line))
          .map((f) => f.line.trim())
          .join(' '),
      ),
      ...parseCategory(categoryText),
    });
    i = end;
  }
  return entries;
}

export function parseMagicItems(
  pages: readonly PageText[],
): MagicItemExtraction[] {
  const flat = flatten(pages);
  const entries = findEntries(flat);
  const out: MagicItemExtraction[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const bodyStart = entry.categoryEnd + 1;
    const bodyEnd = entries[i + 1]?.nameStart ?? flat.length;
    const description = joinParagraphs(
      flat.slice(bodyStart, bodyEnd).map((f) => f.line),
    );
    out.push({
      name: entry.name,
      itemType: entry.itemType,
      rarity: entry.rarity,
      requiresAttunement: entry.requiresAttunement,
      ...(entry.attunementRequirement === undefined
        ? {}
        : { attunementRequirement: entry.attunementRequirement }),
      description: description.length > 0 ? description : entry.name,
      sourcePage: flat[entry.nameStart].page,
    });
  }

  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}
