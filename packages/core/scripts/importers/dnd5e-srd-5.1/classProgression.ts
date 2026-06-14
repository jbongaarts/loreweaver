/**
 * Structured class progression + cross-reference enrichment for the D&D 5e SRD
 * 5.1 importer (eshyra-4a7.6).
 *
 * PR1 emitted every class progression table as a reviewed `table` record. This
 * module turns those same parsed rows into the queryable structures the
 * DM/runtime needs for level advancement, and wires the class/subclass/feature
 * cross-references:
 *
 *   - `class.data.progression`: one entry per level with `proficiencyBonus`,
 *     parsed `features` (linked to the class's `feature` records by name, with
 *     repeated-use parentheticals preserved as `detail`), class `resources`
 *     (Rages, Sneak Attack, Ki Points, Sorcery Points, …), and `spellcasting`
 *     (cantrips/spells known, Pact Magic columns, and the per-level spell-slot
 *     map). Derived from the parsed `TableExtraction` rows — NOT re-parsed from
 *     emitted JSON.
 *   - `class.data.progressionTableRef` + `class.data.features`.
 *   - `subclass.data.spellTableRefs` for the four subclasses with spell tables.
 *   - `feature.data.tableRefs` for Destroy Undead / Beast Shapes, trimming the
 *     flattened table rows out of those two feature descriptions while keeping
 *     the prose that introduces the table.
 *
 * Feature bodies stay the canonical home for feature prose; progression rows
 * only reference feature keys, never duplicate descriptions.
 */

import type { RulesRecord } from '../../../src/rules/types.js';
import type { TableExtraction } from './types.js';

/** Class-resource columns surfaced under `progression[].resources`. */
const RESOURCE_COLUMNS: ReadonlySet<string> = new Set([
  'Rages',
  'Rage Damage',
  'Sneak Attack',
  'Martial Arts',
  'Ki Points',
  'Unarmored Movement',
  'Sorcery Points',
]);

/** Named spellcasting columns surfaced directly under `spellcasting`. */
const SPELL_NAMED_COLUMNS: ReadonlySet<string> = new Set([
  'Cantrips Known',
  'Spells Known',
  'Spell Slots',
  'Slot Level',
  'Invocations Known',
]);

/** Per-spell-level slot columns, nested under `spellcasting.slots`. */
const SLOT_COLUMNS: ReadonlyMap<string, number> = new Map([
  ['1st', 1],
  ['2nd', 2],
  ['3rd', 3],
  ['4th', 4],
  ['5th', 5],
  ['6th', 6],
  ['7th', 7],
  ['8th', 8],
  ['9th', 9],
]);

type Scalar = string | number | null;

interface ProgressionFeature {
  readonly name: string;
  readonly ref?: string;
  readonly detail?: string;
}

interface ProgressionRow {
  readonly level: number;
  readonly proficiencyBonus: string;
  readonly features?: readonly ProgressionFeature[];
  readonly resources?: Readonly<Record<string, Scalar>>;
  readonly spellcasting?: Readonly<
    Record<string, Scalar | Record<string, Scalar>>
  >;
}

function camelCase(label: string): string {
  const words = label.trim().split(/\s+/);
  return words
    .map((w, i) =>
      i === 0
        ? w.toLowerCase()
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join('');
}

/** "1st" -> 1, "20th" -> 20. */
function levelNumber(ordinal: string): number {
  return Number.parseInt(ordinal, 10);
}

/**
 * Normalize a source cell to a queryable scalar: blank -> null (not
 * applicable), a pure integer -> number, everything else (dice, "1/2",
 * "+10 ft.", "1st", "Unlimited", "+2") -> the verbatim string.
 */
function normalizeCell(cell: string): Scalar {
  const text = cell.trim();
  if (text.length === 0) return null;
  if (/^\d+$/.test(text)) return Number.parseInt(text, 10);
  return text;
}

function normalizeName(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Split a Features cell into entries on top-level commas (a parenthetical like
 * "(two uses)" or "(CR 1/2)" never splits), then lift the trailing
 * parenthetical into `detail` and resolve `ref` against the class's feature
 * records by normalized name.
 */
function parseFeatureCell(
  cell: string,
  featureKeyByName: ReadonlyMap<string, string>,
): ProgressionFeature[] {
  const text = cell.trim();
  if (text.length === 0) return [];
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  const features: ProgressionFeature[] = [];
  for (const raw of parts) {
    const segment = raw.trim();
    if (segment.length === 0) continue;
    const paren = /^(.*\S)\s*\(([^()]+)\)$/.exec(segment);
    const name = (paren ? paren[1] : segment).trim();
    const detail = paren ? paren[2].trim() : undefined;
    const ref = featureKeyByName.get(normalizeName(name));
    features.push({
      name,
      ...(ref !== undefined ? { ref } : {}),
      ...(detail !== undefined ? { detail } : {}),
    });
  }
  return features;
}

/**
 * Map one class progression `TableExtraction` to `progression` rows. Columns
 * are classified by name: Level/Proficiency Bonus/Features are special;
 * everything else is a resource or a spellcasting column (named or per-level
 * slot). `featureKeyByName` resolves progression feature refs.
 */
export function deriveClassProgression(
  table: TableExtraction,
  featureKeyByName: ReadonlyMap<string, string>,
): ProgressionRow[] {
  const cols = table.columns;
  const idx = (name: string) => cols.indexOf(name);
  const levelIdx = idx('Level');
  const bonusIdx = idx('Proficiency Bonus');
  const featuresIdx = idx('Features');
  return table.rows.map((row): ProgressionRow => {
    const cells = row.map((c) => String(c));
    const resources: Record<string, Scalar> = {};
    const spellcasting: Record<string, Scalar | Record<string, Scalar>> = {};
    const slots: Record<string, Scalar> = {};
    cols.forEach((col, i) => {
      if (i === levelIdx || i === bonusIdx || i === featuresIdx) return;
      const value = normalizeCell(cells[i] ?? '');
      if (RESOURCE_COLUMNS.has(col)) {
        resources[camelCase(col)] = value;
      } else if (SPELL_NAMED_COLUMNS.has(col)) {
        spellcasting[camelCase(col)] = value;
      } else if (SLOT_COLUMNS.has(col)) {
        if (value !== null) slots[String(SLOT_COLUMNS.get(col))] = value;
      }
    });
    if (Object.keys(slots).length > 0) spellcasting.slots = slots;
    const features =
      featuresIdx >= 0
        ? parseFeatureCell(cells[featuresIdx] ?? '', featureKeyByName)
        : [];
    return {
      level: levelNumber(cells[levelIdx] ?? ''),
      proficiencyBonus: cells[bonusIdx] ?? '',
      ...(features.length > 0 ? { features } : {}),
      ...(Object.keys(resources).length > 0 ? { resources } : {}),
      ...(Object.keys(spellcasting).length > 0 ? { spellcasting } : {}),
    };
  });
}

/** class:<slug> -> table:the-<slug> progression-table key. */
function progressionTableKeyForClass(classKey: string): string {
  const slug = classKey.slice('class:'.length);
  return `table:the-${slug}`;
}

/**
 * Reviewed map of subclasses to the `table` records that carry their
 * spell/expanded-spell lists (eshyra-4a7.6). The Circle of the Land subclass
 * owns all seven terrain tables.
 */
const SUBCLASS_SPELL_TABLE_REFS: ReadonlyMap<string, readonly string[]> =
  new Map([
    ['subclass:life-domain', ['table:life-domain-spells']],
    ['subclass:oath-of-devotion', ['table:oath-of-devotion-spells']],
    ['subclass:the-fiend', ['table:fiend-expanded-spells']],
    [
      'subclass:circle-of-the-land',
      [
        'table:circle-of-the-land-arctic',
        'table:circle-of-the-land-coast',
        'table:circle-of-the-land-desert',
        'table:circle-of-the-land-forest',
        'table:circle-of-the-land-grassland',
        'table:circle-of-the-land-mountain',
        'table:circle-of-the-land-swamp',
      ],
    ],
  ]);

/**
 * Reviewed map of features to the `table` records they own, plus the exact
 * embedded-table span to trim from each feature's description (caption +
 * header + rows), keyed by start marker and an optional end marker. The intro
 * prose that introduces the table is preserved.
 */
const FEATURE_TABLE_REFS: ReadonlyMap<
  string,
  {
    readonly tableRefs: readonly string[];
    readonly trimStart: string;
    readonly trimEnd?: string;
  }
> = new Map([
  [
    'feature:cleric:destroy-undead',
    {
      tableRefs: ['table:destroy-undead'],
      // The flattened table runs from its column header to the end of the body.
      trimStart: 'Cleric Level Destroys Undead of CR',
    },
  ],
  [
    'feature:druid:wild-shape',
    {
      tableRefs: ['table:beast-shapes'],
      // The flattened table is embedded mid-body; keep the prose on both sides.
      trimStart: 'Beast Shapes Max.',
      trimEnd: 'Giant eagle',
    },
  ],
]);

/** Remove an embedded table span from a description, collapsing the seam. */
function trimEmbeddedTable(
  description: string,
  trimStart: string,
  trimEnd?: string,
): string {
  const startIdx = description.indexOf(trimStart);
  if (startIdx < 0) return description; // fail-safe: leave prose untouched
  const endIdx =
    trimEnd === undefined
      ? description.length
      : (() => {
          const found = description.indexOf(trimEnd, startIdx);
          return found < 0 ? -1 : found + trimEnd.length;
        })();
  if (endIdx < 0) return description;
  const joined = `${description.slice(0, startIdx)}${description.slice(endIdx)}`;
  return joined
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,])/g, '$1')
    .trim();
}

function asObj(data: unknown): Record<string, unknown> {
  return (data ?? {}) as Record<string, unknown>;
}

function withData(
  record: RulesRecord,
  extra: Record<string, unknown>,
): RulesRecord {
  return { ...record, data: { ...asObj(record.data), ...extra } };
}

/**
 * Enrich the class-chapter records (eshyra-4a7.6): add structured progression +
 * table/feature refs to classes, spell-table refs to subclasses, and table
 * refs (with description trimming) to the two feature-owned class tables.
 * Returns new record arrays; inputs are not mutated.
 */
export function enrichClassChapterRecords(input: {
  readonly classRecords: readonly RulesRecord[];
  readonly subclassRecords: readonly RulesRecord[];
  readonly featureRecords: readonly RulesRecord[];
  readonly tables: readonly TableExtraction[];
}): {
  readonly classRecords: RulesRecord[];
  readonly subclassRecords: RulesRecord[];
  readonly featureRecords: RulesRecord[];
} {
  const tableByName = new Map(input.tables.map((t) => [t.name, t]));

  // Per-class: feature keys (data.features) and a normalized-name -> key map for
  // progression ref resolution. Subclass features are grouped separately so the
  // subclass feature list can be filled too.
  const classFeatureKeys = new Map<string, string[]>();
  const classFeatureKeyByName = new Map<string, Map<string, string>>();
  const subclassFeatureKeys = new Map<string, string[]>();
  const pushTo = <V>(map: Map<string, V[]>, key: string, value: V): void => {
    const list = map.get(key);
    if (list === undefined) map.set(key, [value]);
    else list.push(value);
  };
  for (const feature of input.featureRecords) {
    const source = String(asObj(feature.data).source ?? '');
    if (source.startsWith('class:')) {
      pushTo(classFeatureKeys, source, feature.key);
      let byName = classFeatureKeyByName.get(source);
      if (byName === undefined) {
        byName = new Map();
        classFeatureKeyByName.set(source, byName);
      }
      byName.set(normalizeName(feature.name), feature.key);
    } else if (source.startsWith('subclass:')) {
      pushTo(subclassFeatureKeys, source, feature.key);
    }
  }

  const classRecords = input.classRecords.map((cls) => {
    const tableKey = progressionTableKeyForClass(cls.key);
    const tableName = `The ${cls.name}`;
    const table = tableByName.get(tableName);
    const features = (classFeatureKeys.get(cls.key) ?? [])
      .slice()
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const byName = classFeatureKeyByName.get(cls.key) ?? new Map();
    const extra: Record<string, unknown> = {};
    if (table !== undefined) {
      extra.progressionTableRef = tableKey;
      extra.progression = deriveClassProgression(table, byName);
    }
    if (features.length > 0) extra.features = features;
    return Object.keys(extra).length > 0 ? withData(cls, extra) : cls;
  });

  const subclassRecords = input.subclassRecords.map((sub) => {
    const extra: Record<string, unknown> = {};
    const spellTableRefs = SUBCLASS_SPELL_TABLE_REFS.get(sub.key);
    if (spellTableRefs !== undefined)
      extra.spellTableRefs = [...spellTableRefs];
    const subFeatures = (subclassFeatureKeys.get(sub.key) ?? [])
      .slice()
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (subFeatures.length > 0 && asObj(sub.data).features === undefined) {
      extra.features = subFeatures;
    }
    return Object.keys(extra).length > 0 ? withData(sub, extra) : sub;
  });

  const featureRecords = input.featureRecords.map((feature) => {
    const spec = FEATURE_TABLE_REFS.get(feature.key);
    if (spec === undefined) return feature;
    const description = trimEmbeddedTable(
      String(asObj(feature.data).description ?? ''),
      spec.trimStart,
      spec.trimEnd,
    );
    return withData(feature, {
      description,
      tableRefs: [...spec.tableRefs],
    });
  });

  return { classRecords, subclassRecords, featureRecords };
}
