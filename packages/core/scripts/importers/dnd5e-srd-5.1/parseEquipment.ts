/**
 * Equipment-table parser for the D&D 5e SRD 5.1 importer.
 *
 * SRD 5.1 presents equipment as tabular data, not stat-block prose. The
 * Equipment chapter holds three tables this parser projects into per-item
 * records:
 *   - the Armor table       (Armor, Cost, Armor Class, Strength, Stealth, Weight)
 *   - the Weapons table      (Name, Cost, Damage, Weight, Properties)
 *   - the Adventuring Gear table (Item, Cost, Weight)
 *
 * Input is a slice of `PageText[]` already narrowed to the Equipment section;
 * output is an `EquipmentExtraction[]` with a stable shape, sorted by name.
 *
 * Extracted-text shape assumption: like the difficulty-class and XP-threshold
 * tables (and unlike the wide column-major treasure tables in `parseTables.ts`),
 * each table row is assumed to extract as a single row-major line whose cells
 * are separated by whitespace, e.g.
 *
 *   Dagger 2 gp 1d4 piercing 1 lb. Finesse, light, thrown (range 20/60)
 *   Leather 10 gp 11 + Dex modifier 10 lb.
 *
 * The parser is a small state machine keyed on the table titles ("Weapons",
 * "Armor", "Adventuring Gear") and their sub-headers ("Simple Melee Weapons",
 * "Light Armor", ...). A non-empty line in a table mode that is neither a
 * recognized sub-header, a column-header row, nor a parseable item row ends the
 * current mode — so the gear table stops at the next chapter subsection rather
 * than running to the end of the slice. If a future vendored PDF extracts these
 * tables column-major instead, they will need the column-block reconstruction
 * `parseTables.ts` uses for treasure tables.
 */

import type { EquipmentExtraction, PageText } from './types.js';

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

type Mode = 'none' | 'weapon' | 'armor' | 'gear';
type ArmorType = 'light' | 'medium' | 'heavy' | 'shield';

// A currency cell, e.g. "2 gp", "1,500 gp", "5 sp". The leading number may
// carry thousands separators.
const COST = /\d{1,3}(?:,\d{3})*\s*(?:cp|sp|ep|gp|pp)/i;
const COST_ANCHORED = new RegExp(`\\b(${COST.source})`, 'i');
// A weight cell, e.g. "1 lb.", "1/4 lb.", "3 lb". Fractions appear for light
// gear (sling bullets, etc.).
const WEIGHT = /\d+(?:\/\d+)?(?:\.\d+)?\s*lb\.?/i;
// A standalone dash cell, used by the SRD as a "no value" weight marker (e.g.
// the Sling's weight column). Only a hyphen / en-dash / em-dash flanked by
// whitespace or string boundaries counts — this deliberately does NOT match a
// within-word hyphen like "two-handed" in a property cell. Capture group 1 is
// the leading boundary so the dash position can be recovered.
const STANDALONE_DASH = /(^|\s)[—–-](?=\s|$)/;

// Table titles switch the parser into the matching mode.
const WEAPONS_TITLE = /^Weapons$/i;
const ARMOR_TITLE = /^Armor$/i;
const GEAR_TITLE = /^Adventuring Gear$/i;

// Sub-headers grouping rows inside a table. Skipped (never treated as rows),
// and the armor sub-header also sets the current armor type.
const WEAPON_SUBHEADER = /^(Simple|Martial) (Melee|Ranged) Weapons$/i;
const ARMOR_SUBHEADER = /^(Light|Medium|Heavy) Armor$/i;
const SHIELD_SUBHEADER = /^Shield$/i;

// Column-header rows. Skipped without ending the table mode.
const WEAPON_COLUMNS = /^Name\b.*\bCost\b.*\bDamage\b/i;
const ARMOR_COLUMNS = /^Armor\b.*\bCost\b.*\bArmor Class/i;
const GEAR_COLUMNS = /^Item\b.*\bCost\b.*\bWeight\b/i;

const DAMAGE = /^(\d+d\d+|\d+)\s+(bludgeoning|piercing|slashing)\b/i;
const STRENGTH_REQ = /\bStr\s+(\d+)\b/i;
const STEALTH_DISADVANTAGE = /\bDisadvantage\b/i;

/** Split a trailing property list on commas into trimmed, non-empty entries. */
function splitProperties(tail: string): string[] {
  const trimmed = tail.trim();
  if (trimmed.length === 0 || /^[—-]+$/.test(trimmed)) {
    return [];
  }
  return trimmed
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** Locate the cost cell; everything before it is the item name. */
function splitNameAndCost(
  line: string,
): { name: string; cost: string; rest: string } | undefined {
  const match = COST_ANCHORED.exec(line);
  if (match === null || match.index === 0) {
    return undefined;
  }
  const name = line.slice(0, match.index).trim();
  const cost = normalizeCost(match[1]);
  const rest = line.slice(match.index + match[1].length).trim();
  if (name.length === 0) {
    return undefined;
  }
  return { name, cost, rest };
}

function normalizeCost(cost: string): string {
  return cost.replace(/\s+/g, ' ').trim();
}

function normalizeWeight(weight: string): string {
  return weight.replace(/\s+/g, ' ').trim();
}

/**
 * Pull the weight cell out of `rest`, returning the surrounding text. A real
 * "N lb." weight wins; failing that, a standalone dash is treated as the
 * (empty) weight cell so any following property text is still split off rather
 * than swallowed into `before`. A dash-marked weight carries no measurable
 * value, so `weight` is left undefined — matching the convention that omits a
 * missing weight rather than storing the dash verbatim.
 */
function splitWeight(rest: string): {
  before: string;
  weight?: string;
  after: string;
} {
  const match = WEIGHT.exec(rest);
  if (match !== null) {
    return {
      before: rest.slice(0, match.index).trim(),
      weight: normalizeWeight(match[0]),
      after: rest.slice(match.index + match[0].length).trim(),
    };
  }
  const dash = STANDALONE_DASH.exec(rest);
  if (dash !== null) {
    const dashIdx = dash.index + dash[1].length;
    return {
      before: rest.slice(0, dashIdx).trim(),
      after: rest.slice(dashIdx + 1).trim(),
    };
  }
  return { before: rest.trim(), after: '' };
}

function parseWeaponRow(
  line: string,
  page: number,
): EquipmentExtraction | undefined {
  const split = splitNameAndCost(line);
  if (split === undefined) {
    return undefined;
  }
  const { before, weight, after } = splitWeight(split.rest);
  const damage = DAMAGE.exec(before);
  return {
    name: split.name,
    category: 'weapon',
    cost: split.cost,
    ...(weight === undefined ? {} : { weight }),
    ...(damage === null
      ? {}
      : { damageDie: damage[1], damageType: damage[2].toLowerCase() }),
    properties: splitProperties(after),
    sourcePage: page,
  };
}

function parseArmorRow(
  line: string,
  page: number,
  armorType: ArmorType | undefined,
): EquipmentExtraction | undefined {
  const split = splitNameAndCost(line);
  if (split === undefined) {
    return undefined;
  }
  const { before: middle, weight } = splitWeight(split.rest);

  let working = middle;
  const stealthDisadvantage = STEALTH_DISADVANTAGE.test(working);
  working = working.replace(STEALTH_DISADVANTAGE, ' ');
  const strengthMatch = STRENGTH_REQ.exec(working);
  working = working.replace(STRENGTH_REQ, ' ');
  const ac = working.replace(/\s+/g, ' ').trim();

  return {
    name: split.name,
    category: 'armor',
    cost: split.cost,
    ...(ac.length > 0 ? { ac } : {}),
    ...(armorType === undefined ? {} : { armorType }),
    stealthDisadvantage,
    ...(strengthMatch === null
      ? {}
      : { strengthRequirement: Number.parseInt(strengthMatch[1], 10) }),
    ...(weight === undefined ? {} : { weight }),
    sourcePage: page,
  };
}

function parseGearRow(
  line: string,
  page: number,
): EquipmentExtraction | undefined {
  const split = splitNameAndCost(line);
  if (split === undefined) {
    return undefined;
  }
  const { weight } = splitWeight(split.rest);
  return {
    name: split.name,
    category: 'gear',
    cost: split.cost,
    ...(weight === undefined ? {} : { weight }),
    sourcePage: page,
  };
}

function armorTypeFromSubheader(line: string): ArmorType | undefined {
  if (SHIELD_SUBHEADER.test(line)) {
    return 'shield';
  }
  const match = ARMOR_SUBHEADER.exec(line);
  if (match === null) {
    return undefined;
  }
  return match[1].toLowerCase() as ArmorType;
}

/**
 * Parse equipment entries from the narrowed Equipment-section `PageText[]`.
 * Returns an `EquipmentExtraction[]` sorted by name.
 */
export function parseEquipment(
  pages: readonly PageText[],
): EquipmentExtraction[] {
  const flat = flatten(pages);
  const out: EquipmentExtraction[] = [];

  let mode: Mode = 'none';
  let armorType: ArmorType | undefined;

  for (const { line: raw, page } of flat) {
    const line = raw.trim();
    if (line.length === 0) {
      continue;
    }

    // Table titles always switch mode, regardless of the current mode.
    if (WEAPONS_TITLE.test(line)) {
      mode = 'weapon';
      continue;
    }
    if (ARMOR_TITLE.test(line)) {
      mode = 'armor';
      armorType = undefined;
      continue;
    }
    if (GEAR_TITLE.test(line)) {
      mode = 'gear';
      continue;
    }

    if (mode === 'weapon') {
      if (WEAPON_SUBHEADER.test(line) || WEAPON_COLUMNS.test(line)) {
        continue;
      }
      const weapon = parseWeaponRow(line, page);
      if (weapon !== undefined) {
        out.push(weapon);
        continue;
      }
      mode = 'none';
      continue;
    }

    if (mode === 'armor') {
      const subType = armorTypeFromSubheader(line);
      if (subType !== undefined) {
        armorType = subType;
        continue;
      }
      if (ARMOR_COLUMNS.test(line)) {
        continue;
      }
      const armor = parseArmorRow(line, page, armorType);
      if (armor !== undefined) {
        out.push(armor);
        continue;
      }
      mode = 'none';
      continue;
    }

    if (mode === 'gear') {
      if (GEAR_COLUMNS.test(line)) {
        continue;
      }
      const gear = parseGearRow(line, page);
      if (gear !== undefined) {
        out.push(gear);
        continue;
      }
      mode = 'none';
    }
  }

  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}
