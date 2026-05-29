/**
 * Deterministic emitter for the D&D 5e SRD 5.1 importer.
 *
 * Takes parsed spell extractions + the class-list index, builds canonical
 * `RulesRecord`s and a `RulesPackMeta`, runs `validateRulesPack` to catch any
 * schema drift before writing, and writes `manifest.json` + `records.json`
 * with stable formatting (sorted-by-key records, fixed field order, 2-space
 * indent, trailing newline).
 *
 * Determinism note: object key order in the emitted JSON is the literal
 * order of the object expressions below. `JSON.stringify` preserves
 * insertion order, so two runs over the same parsed input produce
 * byte-identical files.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  RecordProvenance,
  RulesPack,
  RulesPackLicense,
  RulesPackMeta,
  RulesPackSource,
  RulesRecord,
} from '../../../src/rules/types.js';
import { validateRulesPack } from '../../../src/rules/validate.js';
import type {
  ActionExtraction,
  AncestryExtraction,
  ConditionExtraction,
  EquipmentExtraction,
  FeatExtraction,
  HazardExtraction,
  RuleExtraction,
  SpellCasterClass,
  SpellClassIndex,
  SpellExtraction,
  TableExtraction,
} from './types.js';

const SYSTEM_ID = 'dnd5e-srd';
const PACK_ID = 'rules:dnd5e-srd-5.1';
const SOURCE_URL =
  'https://dnd.wizards.com/resources/systems-reference-document';
const SOURCE_TITLE = 'D&D 5e System Reference Document 5.1';
const SOURCE_VERSION = '5.1';
const SOURCE_DATE = '2023-01-12';

const PROVENANCE_POLICY =
  'Each record names the SRD page it was extracted from when the upstream record carries a page; pageless records cite the SRD section as the locator.';

export const SRD_5_1_LICENSE: RulesPackLicense = {
  licenseClass: 'open',
  licenseName: 'Creative Commons Attribution 4.0 International',
  attributionText:
    'This work includes material from the System Reference Document 5.1 by Wizards of the Coast LLC, available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License.',
  requiresAttribution: true,
  commercialUseAllowed: true,
  hostedUseAllowed: true,
  redistributionAllowed: true,
  publicSharingAllowed: true,
  derivativeAllowed: true,
  containsUserSuppliedText: false,
  containsTrademarkedSettingMaterial: false,
  sourceMaterialDescription: `${SOURCE_TITLE} at ${SOURCE_URL}`,
  provenancePolicy: 'Every record names the SRD page it was extracted from.',
  outputRestrictions:
    'Preserve the SRD 5.1 attribution text on redistributed records and derivatives.',
};

function buildSource(sourceHash: string): RulesPackSource {
  return {
    sourceTitle: SOURCE_TITLE,
    sourceVersion: SOURCE_VERSION,
    sourceUrl: SOURCE_URL,
    sourceHash,
    sourceDate: SOURCE_DATE,
    recordProvenancePolicy: PROVENANCE_POLICY,
  };
}

function buildMeta(
  sourceHash: string,
  includedKinds: readonly string[],
): RulesPackMeta {
  // The description is intentionally explicit about which kinds the current
  // importer covers; this prevents callers from assuming a half-built pack is
  // reference-complete. See ADR 0005 and the loreweaver-0m9.5 issue.
  return {
    packId: PACK_ID,
    title: 'D&D 5e SRD 5.1',
    description: `D&D 5th Edition System Reference Document 5.1, extracted by the deterministic importer at packages/core/scripts/importers/dnd5e-srd-5.1. Included record kinds: ${includedKinds.join(', ')}. Other SRD record kinds are tracked under loreweaver-0m9.5 child issues and are not included until their parsers ship.`,
    role: 'base',
    systemId: SYSTEM_ID,
    version: SOURCE_VERSION,
    license: SRD_5_1_LICENSE,
    source: buildSource(sourceHash),
  };
}

function spellKey(name: string): string {
  return `spell:${slug(name)}`;
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function provenanceFor(page: number): RecordProvenance {
  return {
    sourceRef: SOURCE_URL,
    locator: `p. ${page}`,
  };
}

function sourceLabelFor(page: number): string {
  return `SRD 5.1 p. ${page}`;
}

export function spellExtractionsToRecords(
  spells: readonly SpellExtraction[],
  classes: ReadonlyMap<string, readonly SpellCasterClass[]>,
): RulesRecord[] {
  const out: RulesRecord[] = spells.map((spell) => {
    const classList = classes.get(spell.name) ?? [];
    const data = buildSpellData(spell, classList);
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'spell',
      key: spellKey(spell.name),
      name: spell.name,
      data,
      source: sourceLabelFor(spell.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(spell.sourcePage),
    };
    return record;
  });
  // Stable record order by key (loadRulesPackFromDirectory also sorts on read,
  // but emitting sorted means the on-disk file is human-readable in order).
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

function buildSpellData(
  spell: SpellExtraction,
  classes: readonly SpellCasterClass[],
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    level: spell.level,
    school: spell.school,
    castingTime: spell.castingTime,
    range: spell.range,
    duration: spell.duration,
    components: [...spell.components],
    classes: [...classes],
    description: spell.description,
  };
  if (spell.componentMaterials !== undefined) {
    base.componentMaterials = spell.componentMaterials;
  }
  if (spell.ritual) {
    base.ritual = true;
  }
  if (spell.higherLevels !== undefined) {
    base.higherLevels = spell.higherLevels;
  }
  return base;
}

function conditionKey(name: string): string {
  return `condition:${slug(name)}`;
}

function featKey(name: string): string {
  return `feat:${slug(name)}`;
}

function hazardKey(name: string): string {
  return `hazard:${slug(name)}`;
}

function ruleKey(name: string): string {
  return `rule:${slug(name)}`;
}

function actionKey(name: string): string {
  return `action:${slug(name)}`;
}

function tableKey(name: string): string {
  return `table:${slug(name)}`;
}

function equipmentKey(name: string): string {
  return `equipment:${slug(name)}`;
}

function ancestryKey(name: string): string {
  return `ancestry:${slug(name)}`;
}

export function conditionExtractionsToRecords(
  conditions: readonly ConditionExtraction[],
): RulesRecord[] {
  const out: RulesRecord[] = conditions.map((condition) => {
    const data: Record<string, unknown> = {
      description: condition.description,
    };
    if (condition.effects.length > 0) {
      data.effects = [...condition.effects];
    }
    if (condition.levels !== undefined && condition.levels.length > 0) {
      data.levels = condition.levels.map((l) => ({
        level: l.level,
        effect: l.effect,
      }));
    }
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'condition',
      key: conditionKey(condition.name),
      name: condition.name,
      data,
      source: sourceLabelFor(condition.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(condition.sourcePage),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

export function featExtractionsToRecords(
  feats: readonly FeatExtraction[],
): RulesRecord[] {
  const out: RulesRecord[] = feats.map((feat) => {
    const data: Record<string, unknown> = {
      description: feat.description,
    };
    if (feat.prerequisites !== undefined) {
      data.prerequisites = feat.prerequisites;
    }
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'feat',
      key: featKey(feat.name),
      name: feat.name,
      data,
      source: sourceLabelFor(feat.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(feat.sourcePage),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

export function hazardExtractionsToRecords(
  hazards: readonly HazardExtraction[],
): RulesRecord[] {
  const out: RulesRecord[] = hazards.map((hazard) => {
    const data: Record<string, unknown> = {
      description: hazard.description,
    };
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'hazard',
      key: hazardKey(hazard.name),
      name: hazard.name,
      data,
      source: sourceLabelFor(hazard.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(hazard.sourcePage),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

export function ruleExtractionsToRecords(
  rules: readonly RuleExtraction[],
): RulesRecord[] {
  const out: RulesRecord[] = rules.map((rule) => {
    const data: Record<string, unknown> = {
      text: rule.text,
    };
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'rule',
      key: ruleKey(rule.name),
      name: rule.name,
      data,
      source: sourceLabelFor(rule.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(rule.sourcePage),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

export function actionExtractionsToRecords(
  actions: readonly ActionExtraction[],
): RulesRecord[] {
  const out: RulesRecord[] = actions.map((action) => {
    const data: Record<string, unknown> = {
      description: action.description,
    };
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'action',
      key: actionKey(action.name),
      name: action.name,
      data,
      source: sourceLabelFor(action.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(action.sourcePage),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

export function tableExtractionsToRecords(
  tables: readonly TableExtraction[],
): RulesRecord[] {
  const out: RulesRecord[] = tables.map((table) => {
    const data: Record<string, unknown> = {
      columns: [...table.columns],
      rows: table.rows.map((row) => [...row]),
    };
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'table',
      key: tableKey(table.name),
      name: table.name,
      data,
      source: sourceLabelFor(table.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(table.sourcePage),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

/**
 * Build the `data` payload for one equipment record. Field insertion order is
 * fixed (so emitted JSON is byte-stable) and category-specific fields are
 * present only for the matching `category`. The record validates against the
 * `equipment` baseline kindSchema (a non-null `data` object); see
 * `kindSchemas.ts`.
 */
function buildEquipmentData(
  item: EquipmentExtraction,
): Record<string, unknown> {
  const data: Record<string, unknown> = { category: item.category };
  if (item.cost !== undefined) {
    data.cost = item.cost;
  }
  if (item.category === 'weapon') {
    if (item.damageDie !== undefined) {
      data.damageDie = item.damageDie;
    }
    if (item.damageType !== undefined) {
      data.damageType = item.damageType;
    }
    data.properties = [...(item.properties ?? [])];
  }
  if (item.category === 'armor') {
    if (item.ac !== undefined) {
      data.ac = item.ac;
    }
    if (item.armorType !== undefined) {
      data.armorType = item.armorType;
    }
    data.stealthDisadvantage = item.stealthDisadvantage ?? false;
    if (item.strengthRequirement !== undefined) {
      data.strengthRequirement = item.strengthRequirement;
    }
  }
  if (item.weight !== undefined) {
    data.weight = item.weight;
  }
  return data;
}

export function equipmentExtractionsToRecords(
  equipment: readonly EquipmentExtraction[],
): RulesRecord[] {
  const out: RulesRecord[] = equipment.map((item) => {
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'equipment',
      key: equipmentKey(item.name),
      name: item.name,
      data: buildEquipmentData(item),
      source: sourceLabelFor(item.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(item.sourcePage),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

export function ancestryExtractionsToRecords(
  ancestries: readonly AncestryExtraction[],
): RulesRecord[] {
  const out: RulesRecord[] = ancestries.map((ancestry) => {
    // `source: 'race'` preserves the SRD 5.1 source term while the record kind
    // is the canonical 'ancestry' (ADR 0005). Field order is literal for
    // byte-stable output.
    const data: Record<string, unknown> = {
      source: 'race',
      description: ancestry.description,
    };
    if (ancestry.size !== undefined) {
      data.size = ancestry.size;
    }
    if (ancestry.speed !== undefined) {
      data.speed = ancestry.speed;
    }
    data.traits = ancestry.traits.map((t) => ({ name: t.name, text: t.text }));
    if (ancestry.subraceOf !== undefined) {
      data.subraceOf = ancestryKey(ancestry.subraceOf);
    }
    if (ancestry.subraces !== undefined && ancestry.subraces.length > 0) {
      data.subraces = ancestry.subraces.map((name) => ancestryKey(name));
    }
    const record: RulesRecord = {
      systemId: SYSTEM_ID,
      kind: 'ancestry',
      key: ancestryKey(ancestry.name),
      name: ancestry.name,
      data,
      source: sourceLabelFor(ancestry.sourcePage),
      license: SRD_5_1_LICENSE,
      provenance: provenanceFor(ancestry.sourcePage),
    };
    return record;
  });
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

export interface BuildPackInput {
  readonly spells: readonly SpellExtraction[];
  readonly classIndex: SpellClassIndex;
  readonly conditions: readonly ConditionExtraction[];
  readonly feats?: readonly FeatExtraction[];
  readonly hazards?: readonly HazardExtraction[];
  readonly actions?: readonly ActionExtraction[];
  readonly rules?: readonly RuleExtraction[];
  readonly tables?: readonly TableExtraction[];
  readonly equipment?: readonly EquipmentExtraction[];
  readonly ancestries?: readonly AncestryExtraction[];
  readonly sourceHash: string;
}

export function buildPack(input: BuildPackInput): RulesPack {
  const classByName = new Map<string, readonly SpellCasterClass[]>();
  for (const spell of input.spells) {
    const bucket = input.classIndex.get(spell.name);
    classByName.set(
      spell.name,
      bucket ? [...bucket].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) : [],
    );
  }
  const spellRecords = spellExtractionsToRecords(input.spells, classByName);
  const conditionRecords = conditionExtractionsToRecords(input.conditions);
  const featRecords = featExtractionsToRecords(input.feats ?? []);
  const hazardRecords = hazardExtractionsToRecords(input.hazards ?? []);
  const actionRecords = actionExtractionsToRecords(input.actions ?? []);
  const ruleRecords = ruleExtractionsToRecords(input.rules ?? []);
  const tableRecords = tableExtractionsToRecords(input.tables ?? []);
  const equipmentRecords = equipmentExtractionsToRecords(input.equipment ?? []);
  const ancestryRecords = ancestryExtractionsToRecords(input.ancestries ?? []);
  const records = [
    ...spellRecords,
    ...conditionRecords,
    ...featRecords,
    ...hazardRecords,
    ...actionRecords,
    ...ruleRecords,
    ...tableRecords,
    ...equipmentRecords,
    ...ancestryRecords,
  ].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const includedKinds = uniqueKindsOf(records);
  const pack: RulesPack = {
    meta: buildMeta(input.sourceHash, includedKinds),
    records,
  };
  // Throws on schema / provenance / structural error.
  return validateRulesPack(pack);
}

function uniqueKindsOf(records: readonly RulesRecord[]): readonly string[] {
  const set = new Set<string>();
  for (const r of records) set.add(r.kind);
  return [...set].sort();
}

/** Stable JSON serialization: 2-space indent, trailing newline. */
function stringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export interface WritePackOptions {
  readonly outDir: string;
}

export function writePackToDirectory(
  pack: RulesPack,
  options: WritePackOptions,
): void {
  mkdirSync(options.outDir, { recursive: true });
  writeFileSync(
    join(options.outDir, 'manifest.json'),
    stringify(pack.meta),
    'utf8',
  );
  writeFileSync(
    join(options.outDir, 'records.json'),
    stringify(pack.records),
    'utf8',
  );
}
