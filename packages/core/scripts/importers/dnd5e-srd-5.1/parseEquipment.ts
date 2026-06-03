/**
 * Equipment-table parser for the D&D 5e SRD 5.1 importer.
 *
 * SRD 5.1 presents equipment as tabular data, not stat-block prose. This parser
 * projects four Equipment-chapter tables into per-item records:
 *   - the Armor table   (Armor, Cost, Armor Class, Strength, Stealth, Weight)
 *   - the Weapons table  (Name, Cost, Damage, Weight, Properties)
 *   - the Tools table    (Item, Cost, Weight — artisan's tools, instruments, …)
 *
 * Extracted-text shape (the real vendored PDF, loreweaver-3n6): the SRD 5.1
 * Armor and Weapons tables are laid out as two *physical columns* on the page,
 * and the PDF text extractor reads each physical column top-to-bottom. The
 * result is that each table's cells arrive split into a LEFT column-block and a
 * RIGHT column-block, with descriptive prose interleaved between them:
 *
 *   Armor:   left  = "Padded 5 gp 11 + Dex modifier"   (Name Cost ArmorClass)
 *            right = "— Disadvantage 8 lb."            (Strength Stealth Weight)
 *   Weapons: left  = "Dagger 2 gp 1d4 piercing"        (Name Cost Damage)
 *            right = "1 lb. Finesse, light, thrown (range 20/60)" (Weight Props)
 *
 * Both blocks preserve row order, so each table is reconstructed by collecting
 * its left rows and right rows and zipping them positionally — the same
 * column-block reconstruction `parseTables.ts` uses for the treasure tables.
 * The Tools table, by contrast, extracts row-major ("Smith's tools 20 gp 8 lb.")
 * and is parsed line-by-line.
 *
 * Out of scope (documented on loreweaver-3n6): the Adventuring Gear table, the
 * Container Capacity / Equipment Packs lists, and the Mounts and Vehicles
 * section. In the vendored SRD 5.1 PDF the Adventuring Gear table extracts as
 * two interleaved physical columns whose item NAMES are fully separated from
 * their cost/weight cells (the names arrive as a bare run — "Abacus", "Acid
 * (vial)", … — then the cost/weight cells arrive interleaved with the adjacent
 * column's complete rows), and several rows are category headers with no cost
 * cell at all, so the name list and the value list have different lengths.
 * There is no reliable positional pairing, and the importer's fail-closed
 * principle (ADR 0007) forbids guessing the alignment, so gear is intentionally
 * omitted rather than emitted with fabricated cost/weight pairings.
 */

import type { EquipmentExtraction, PageText } from './types.js';

/**
 * Thrown when a split-column table's left and right column-blocks do not pair
 * one-to-one. The Armor and Weapons tables are reconstructed by zipping their
 * left rows (Name/Cost/AC or Name/Cost/Damage) with their right rows
 * (Strength/Stealth/Weight or Weight/Properties) positionally, which is only
 * sound when both blocks have the same length. A mismatch means the extraction
 * drifted (a row was dropped, an extra line matched a column-block shape, or
 * the page layout changed); rather than guess the alignment and emit plausible
 * but wrong records, the parser fails closed per the SRD importer policy
 * (ADR 0007). The message names the table and both counts.
 */
export class EquipmentColumnMismatchError extends Error {
  constructor(
    public readonly table: 'Armor' | 'Weapon',
    public readonly leftCount: number,
    public readonly rightCount: number,
  ) {
    super(
      `${table} table column mismatch: left=${leftCount} right=${rightCount}. ` +
        'The split-column extraction drifted; refusing to zip mismatched blocks.',
    );
    this.name = 'EquipmentColumnMismatchError';
  }
}

interface FlatLine {
  readonly line: string;
  readonly page: number;
}

function flatten(pages: readonly PageText[]): readonly FlatLine[] {
  const out: FlatLine[] = [];
  for (const page of pages) {
    for (const line of page.lines) {
      out.push({ line: line.trim(), page: page.pageNumber });
    }
  }
  return out;
}

type ArmorType = 'light' | 'medium' | 'heavy' | 'shield';

/**
 * Classify an armor's weight class from its Armor Class cell. This is more
 * robust than tracking the table's "Light Armor"/"Medium Armor"/… sub-headers:
 * the SRD 5.1 PDF prints those same strings as body-prose section headings
 * interleaved with the table (a "Heavy Armor" description heading sits between
 * the Padded row and the page-2 Leather row), so a running sub-header state
 * misassigns the rows that straddle a page. The AC cell, by contrast, is a
 * stable 5e signature: light armor adds Dex with no cap ("11 + Dex modifier"),
 * medium caps it ("14 + Dex modifier (max 2)"), heavy is a flat number ("18"),
 * and a shield is a bonus ("+2").
 */
function armorTypeFromAc(ac: string): ArmorType {
  if (/^\+\d+$/.test(ac)) return 'shield';
  if (/\(max \d+\)/.test(ac)) return 'medium';
  if (/\+ Dex modifier$/.test(ac)) return 'light';
  return 'heavy';
}

// A currency cell, e.g. "2 gp", "1,500 gp", "5 sp". The leading number may
// carry thousands separators.
const COST = /\d{1,3}(?:,\d{3})*\s*(?:cp|sp|ep|gp|pp)/i;
const COST_ANCHORED = new RegExp(`\\b(${COST.source})`, 'i');
// A weight cell, e.g. "1 lb.", "1/4 lb.", "3 lb". Fractions appear for light
// gear/weapons (dart, sling bullets, etc.).
const WEIGHT_CELL = /\d+(?:\/\d+)?(?:\.\d+)?\s*lb\.?/i;
const WEIGHT_OR_DASH = new RegExp(`^(${WEIGHT_CELL.source}|[—–-])`, 'i');

// Armor LEFT-block row tail: everything after "<name> <cost> " must be exactly
// an Armor Class cell — a base AC ("18"), a Dex-modifier AC ("11 + Dex
// modifier", "14 + Dex modifier (max 2)"), or a shield bonus ("+2"). Anchoring
// the whole tail to an AC token (and nothing trailing) is what distinguishes an
// armor left-row from a weapon left-row or a gear/tool row — and the AC token
// shapes are unique to the Armor table across the whole Equipment chapter, so
// armor left-rows can be collected globally without a region scan.
const ARMOR_AC_TOKEN = /^(?:\d+(?: \+ Dex modifier(?: \(max \d+\))?)?|\+\d+)$/;
// Armor RIGHT-block row: "<Strength> <Stealth> <Weight>", where Strength is
// "Str N" or a dash, Stealth is "Disadvantage" or a dash, and Weight is a
// weight cell. This shape is unique to the Armor table, so right rows are also
// collected globally.
const ARMOR_RIGHT =
  /^(Str \d+|[—–-])\s+(Disadvantage|[—–-])\s+(\d+(?:\/\d+)?(?:\.\d+)?\s*lb\.?)$/i;

// Weapon sub-headers and the weapon column-header. Used to bound the weapon
// LEFT-block region.
const WEAPON_FIRST_SUBHEADER = /^Simple Melee Weapons$/i;
const GEAR_TITLE = /^Adventuring Gear$/i;
// Weapon LEFT-block row tail: everything after "<name> <cost> " must be exactly
// a damage cell ("1d8 slashing", "1 piercing") or a dash (the Net has no
// damage). The trailing-dash form collides with gear/tool rows that have a "—"
// weight cell, so weapon left-rows are collected only within the bounded weapon
// region (first weapon sub-header → "Adventuring Gear"), never globally.
const WEAPON_DAMAGE_TOKEN =
  /^((\d+d\d+|\d+) (bludgeoning|piercing|slashing)|[—–-])$/i;
const WEAPON_DAMAGE_PARTS = /^(\d+d\d+|\d+) (bludgeoning|piercing|slashing)$/i;

// Tools table column header and the row that closes it. The Tools table
// extracts row-major; "Vehicles (land or water)" is the final table line (its
// cost/weight are "*", pointing at the Mounts and Vehicles section) and marks
// the end of the parseable rows.
const TOOLS_COLUMN_HEADER = /^Item Cost Weight$/i;
const VEHICLES_ROW = /^Vehicles \(land or water\)/i;
// Tools row tail: "<name> <cost> <weight-or-dash>" with nothing trailing.
const TOOL_TAIL = new RegExp(`^(${WEIGHT_CELL.source}|[—–-])$`, 'i');

/** Locate the cost cell; everything before it is the item name. */
function splitNameAndCost(
  line: string,
): { name: string; cost: string; rest: string } | undefined {
  const match = COST_ANCHORED.exec(line);
  if (match === null || match.index === 0) {
    return undefined;
  }
  const name = line.slice(0, match.index).trim();
  if (name.length === 0) {
    return undefined;
  }
  return {
    name,
    cost: normalize(match[1]),
    rest: line.slice(match.index + match[1].length).trim(),
  };
}

function normalize(cell: string): string {
  return cell.replace(/\s+/g, ' ').trim();
}

/** Split a trailing property list on commas into trimmed, non-empty entries. */
function splitProperties(tail: string): string[] {
  const trimmed = tail.trim();
  if (trimmed.length === 0 || /^[—–-]+$/.test(trimmed)) {
    return [];
  }
  return trimmed
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

interface ArmorLeft {
  readonly name: string;
  readonly cost: string;
  readonly ac: string;
  readonly armorType: ArmorType;
  readonly page: number;
}

interface ArmorRight {
  readonly strengthRequirement?: number;
  readonly stealthDisadvantage: boolean;
  readonly weight: string;
}

/**
 * Collect the Armor table by zipping its two column-blocks. Both the left rows
 * (Name/Cost/AC) and the right rows (Strength/Stealth/Weight) are identified by
 * shapes unique to the Armor table, so a single document-order pass collects
 * both. Each row's weight class comes from its AC cell (`armorTypeFromAc`), not
 * from the table sub-headers, which the body prose duplicates.
 */
function collectArmor(flat: readonly FlatLine[]): EquipmentExtraction[] {
  const left: ArmorLeft[] = [];
  const right: ArmorRight[] = [];

  for (const { line, page } of flat) {
    const rightMatch = ARMOR_RIGHT.exec(line);
    if (rightMatch !== null) {
      const strength = /^Str (\d+)$/i.exec(rightMatch[1]);
      right.push({
        ...(strength === null
          ? {}
          : { strengthRequirement: Number.parseInt(strength[1], 10) }),
        stealthDisadvantage: /Disadvantage/i.test(rightMatch[2]),
        weight: normalize(rightMatch[3]),
      });
      continue;
    }
    const split = splitNameAndCost(line);
    if (split !== undefined && ARMOR_AC_TOKEN.test(split.rest)) {
      const ac = normalize(split.rest);
      left.push({
        name: split.name,
        cost: split.cost,
        ac,
        armorType: armorTypeFromAc(ac),
        page,
      });
    }
  }

  if (left.length !== right.length) {
    throw new EquipmentColumnMismatchError('Armor', left.length, right.length);
  }

  return left.map((row, i) => {
    const tail = right[i];
    return {
      name: row.name,
      category: 'armor',
      cost: row.cost,
      ac: row.ac,
      armorType: row.armorType,
      stealthDisadvantage: tail.stealthDisadvantage,
      ...(tail.strengthRequirement === undefined
        ? {}
        : { strengthRequirement: tail.strengthRequirement }),
      ...(tail.weight === undefined ? {} : { weight: tail.weight }),
      sourcePage: row.page,
    };
  });
}

interface WeaponLeft {
  readonly name: string;
  readonly cost: string;
  readonly damageDie?: string;
  readonly damageType?: string;
  readonly page: number;
}

interface WeaponRight {
  readonly weight?: string;
  readonly properties: readonly string[];
}

/**
 * Collect the Weapons table by zipping its two column-blocks. The left rows
 * (Name/Cost/Damage) are bounded to the weapon region (first weapon sub-header
 * up to the "Adventuring Gear" title) because the Net's dash-damage row shares
 * a shape with gear/tool dash rows; the right rows (Weight/Properties) form a
 * single contiguous run immediately after that title (the right physical column
 * of the weapons page extracts after the gear heading).
 */
function collectWeapons(flat: readonly FlatLine[]): EquipmentExtraction[] {
  const startIdx = flat.findIndex((f) => WEAPON_FIRST_SUBHEADER.test(f.line));
  const gearIdx = flat.findIndex((f) => GEAR_TITLE.test(f.line));
  if (startIdx === -1 || gearIdx === -1 || gearIdx <= startIdx) {
    return [];
  }

  const left: WeaponLeft[] = [];
  for (let i = startIdx; i < gearIdx; i++) {
    const { line, page } = flat[i];
    const split = splitNameAndCost(line);
    if (split === undefined || !WEAPON_DAMAGE_TOKEN.test(split.rest)) {
      continue;
    }
    const dmg = WEAPON_DAMAGE_PARTS.exec(split.rest);
    left.push({
      name: split.name,
      cost: split.cost,
      ...(dmg === null
        ? {}
        : { damageDie: dmg[1], damageType: dmg[2].toLowerCase() }),
      page,
    });
  }

  // The right column-block is the first contiguous run of weight/properties
  // lines after the gear title.
  const right: WeaponRight[] = [];
  let started = false;
  for (let i = gearIdx + 1; i < flat.length; i++) {
    const match = WEIGHT_OR_DASH.exec(flat[i].line);
    if (match === null) {
      if (started) break;
      continue;
    }
    started = true;
    const weightCell = WEIGHT_CELL.test(match[1])
      ? normalize(match[1])
      : undefined;
    right.push({
      ...(weightCell === undefined ? {} : { weight: weightCell }),
      properties: splitProperties(flat[i].line.slice(match[0].length)),
    });
  }

  if (left.length !== right.length) {
    throw new EquipmentColumnMismatchError('Weapon', left.length, right.length);
  }

  return left.map((row, i) => {
    const tail = right[i];
    return {
      name: row.name,
      category: 'weapon',
      cost: row.cost,
      ...(row.damageDie === undefined ? {} : { damageDie: row.damageDie }),
      ...(row.damageType === undefined ? {} : { damageType: row.damageType }),
      properties: [...tail.properties],
      ...(tail.weight === undefined ? {} : { weight: tail.weight }),
      sourcePage: row.page,
    };
  });
}

/**
 * Collect the Tools table. It extracts row-major, so each "<name> <cost>
 * <weight>" line is a record; the category sub-headers (Artisan's tools,
 * Gaming set, Musical instrument) carry no cost cell and are skipped. The table
 * is bounded by its column header and the closing "Vehicles (land or water)"
 * row.
 */
function collectTools(flat: readonly FlatLine[]): EquipmentExtraction[] {
  const headerIdx = flat.findIndex((f) => TOOLS_COLUMN_HEADER.test(f.line));
  if (headerIdx === -1) {
    return [];
  }
  const out: EquipmentExtraction[] = [];
  for (let i = headerIdx + 1; i < flat.length; i++) {
    const { line, page } = flat[i];
    if (VEHICLES_ROW.test(line)) {
      break;
    }
    const split = splitNameAndCost(line);
    if (split === undefined || !TOOL_TAIL.test(split.rest)) {
      continue;
    }
    const weight = WEIGHT_CELL.test(split.rest)
      ? normalize(split.rest)
      : undefined;
    out.push({
      name: split.name,
      category: 'tool',
      cost: split.cost,
      ...(weight === undefined ? {} : { weight }),
      sourcePage: page,
    });
  }
  return out;
}

/**
 * Parse equipment entries from the narrowed Equipment-section `PageText[]`.
 * Returns an `EquipmentExtraction[]` sorted by name.
 */
export function parseEquipment(
  pages: readonly PageText[],
): EquipmentExtraction[] {
  const flat = flatten(pages);
  const out: EquipmentExtraction[] = [
    ...collectArmor(flat),
    ...collectWeapons(flat),
    ...collectTools(flat),
  ];
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}
