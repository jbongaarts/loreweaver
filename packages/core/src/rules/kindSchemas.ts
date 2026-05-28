// Kind-specific schema validation for rules records.
//
// Every record kind has a baseline validator that all systems share. Where a
// system supplies structured data for a given kind (today: `dnd5e-srd` for
// spell/creature/class, `pathfinder2e-remaster` for ancestry/background/
// class/feat/equipment/spell), a system-specific validator layers additional
// shape checks on top. Unregistered (system, kind) pairs fall through to the
// baseline check, so a new importer can ship records before its deeper
// schemas exist.

import type { RulesRecord, RulesRecordKind } from './types.js';
import { RulesPackError } from './types.js';

type Obj = Record<string, unknown>;
type Validator = (record: RulesRecord, path: string) => void;

function dataObj(record: RulesRecord, path: string): Obj {
  const value = record.data;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RulesPackError(`${path}.data must be a non-null object`);
  }
  return value as Obj;
}

function reqStr(parent: Obj, key: string, path: string): string {
  const value = parent[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new RulesPackError(`${path}.${key} must be a non-empty string`);
  }
  return value;
}

function reqNum(parent: Obj, key: string, path: string): number {
  const value = parent[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RulesPackError(`${path}.${key} must be a finite number`);
  }
  return value;
}

function reqInt(parent: Obj, key: string, path: string, min?: number): number {
  const value = reqNum(parent, key, path);
  if (!Number.isInteger(value)) {
    throw new RulesPackError(`${path}.${key} must be an integer`);
  }
  if (min !== undefined && value < min) {
    throw new RulesPackError(`${path}.${key} must be >= ${min}`);
  }
  return value;
}

function reqStrArray(
  parent: Obj,
  key: string,
  path: string,
): readonly string[] {
  const value = parent[key];
  if (!Array.isArray(value)) {
    throw new RulesPackError(`${path}.${key} must be an array`);
  }
  value.forEach((item, i) => {
    if (typeof item !== 'string' || item.length === 0) {
      throw new RulesPackError(
        `${path}.${key}[${i}] must be a non-empty string`,
      );
    }
  });
  return value as readonly string[];
}

function reqObj(parent: Obj, key: string, path: string): Obj {
  const value = parent[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RulesPackError(`${path}.${key} must be a non-null object`);
  }
  return value as Obj;
}

function optStr(parent: Obj, key: string, path: string): void {
  const value = parent[key];
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new RulesPackError(
      `${path}.${key} must be a non-empty string when present`,
    );
  }
}

function optStrArray(parent: Obj, key: string, path: string): void {
  const value = parent[key];
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new RulesPackError(`${path}.${key} must be an array when present`);
  }
  value.forEach((item, i) => {
    if (typeof item !== 'string' || item.length === 0) {
      throw new RulesPackError(
        `${path}.${key}[${i}] must be a non-empty string`,
      );
    }
  });
}

function optBool(parent: Obj, key: string, path: string): void {
  const value = parent[key];
  if (value === undefined) {
    return;
  }
  if (typeof value !== 'boolean') {
    throw new RulesPackError(`${path}.${key} must be a boolean when present`);
  }
}

// Baseline per-kind validators. Every record of the kind must satisfy these
// minimum shape constraints. The shared rule is `data` is a non-null object
// and `description` (if present) is a non-empty string; some kinds add a few
// more cross-system minimums.

function baseObjectKind(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  optStr(data, 'description', `${path}.data`);
}

const BASE_KIND_VALIDATORS: Record<RulesRecordKind, Validator> = {
  ability: baseObjectKind,
  action: baseObjectKind,
  ancestry: baseObjectKind,
  background: baseObjectKind,
  class: baseObjectKind,
  condition: baseObjectKind,
  creature: baseObjectKind,
  equipment: baseObjectKind,
  feat: baseObjectKind,
  hazard: baseObjectKind,
  rule: (record, path) => {
    // Rule records always carry the rule body as `text`.
    const data = dataObj(record, path);
    reqStr(data, 'text', `${path}.data`);
  },
  spell: baseObjectKind,
  table: (record, path) => {
    // Tables always carry column headers and rows.
    const data = dataObj(record, path);
    reqStrArray(data, 'columns', `${path}.data`);
    const rows = data.rows;
    if (!Array.isArray(rows)) {
      throw new RulesPackError(`${path}.data.rows must be an array`);
    }
    rows.forEach((row, i) => {
      if (!Array.isArray(row)) {
        throw new RulesPackError(`${path}.data.rows[${i}] must be an array`);
      }
    });
  },
};

// System-specific deeper validators. These run AFTER the baseline check.

function validateDnd5eSpell(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqInt(data, 'level', `${path}.data`, 0);
  reqStr(data, 'school', `${path}.data`);
  reqStr(data, 'castingTime', `${path}.data`);
  reqStr(data, 'range', `${path}.data`);
  reqStr(data, 'duration', `${path}.data`);
  reqStrArray(data, 'components', `${path}.data`);
  reqStrArray(data, 'classes', `${path}.data`);
}

function validateDnd5eCreature(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqStr(data, 'size', `${path}.data`);
  reqStr(data, 'type', `${path}.data`);
  reqStr(data, 'alignment', `${path}.data`);
  reqInt(data, 'armorClass', `${path}.data`, 0);
  reqInt(data, 'hitPoints', `${path}.data`, 0);
  reqObj(data, 'speed', `${path}.data`);
  reqStr(data, 'challengeRating', `${path}.data`);
  const abilities = reqObj(data, 'abilityScores', `${path}.data`);
  for (const key of [
    'strength',
    'dexterity',
    'constitution',
    'intelligence',
    'wisdom',
    'charisma',
  ]) {
    reqInt(abilities, key, `${path}.data.abilityScores`, 1);
  }
}

function validateDnd5eClass(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqInt(data, 'hitDie', `${path}.data`, 1);
  reqStrArray(data, 'primaryAbilities', `${path}.data`);
  reqStrArray(data, 'savingThrowProficiencies', `${path}.data`);
  reqStrArray(data, 'armorProficiencies', `${path}.data`);
  reqStrArray(data, 'weaponProficiencies', `${path}.data`);
}

function validateDnd5eCondition(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqStr(data, 'description', `${path}.data`);
  optStrArray(data, 'effects', `${path}.data`);
}

function validatePf2eAncestry(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqInt(data, 'hitPoints', `${path}.data`, 1);
  reqStr(data, 'size', `${path}.data`);
  reqInt(data, 'speed', `${path}.data`, 0);
  reqStrArray(data, 'traits', `${path}.data`);
  reqObj(data, 'languages', `${path}.data`);
  reqObj(data, 'abilityBoosts', `${path}.data`);
}

function validatePf2eBackground(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqObj(data, 'abilityBoosts', `${path}.data`);
  reqStrArray(data, 'skillTraining', `${path}.data`);
  reqStr(data, 'skillFeat', `${path}.data`);
  optStr(data, 'loreTraining', `${path}.data`);
}

function validatePf2eClass(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqObj(data, 'keyAbility', `${path}.data`);
  reqInt(data, 'hitPointsPerLevel', `${path}.data`, 1);
  reqObj(data, 'initialProficiencies', `${path}.data`);
  reqObj(data, 'skills', `${path}.data`);
  reqObj(data, 'classFeats', `${path}.data`);
}

function validatePf2eFeat(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqInt(data, 'level', `${path}.data`, 1);
  reqStrArray(data, 'traits', `${path}.data`);
  // actionCost may be a string ('reaction'), null (passive), or an integer
  // (number of actions). Validate the shape rather than constrain the value.
  const actionCost = data.actionCost;
  if (
    actionCost !== null &&
    typeof actionCost !== 'string' &&
    typeof actionCost !== 'number'
  ) {
    throw new RulesPackError(
      `${path}.data.actionCost must be null, a string, or a number`,
    );
  }
  reqStr(data, 'effect', `${path}.data`);
  optStr(data, 'trigger', `${path}.data`);
}

function validatePf2eEquipment(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqStr(data, 'category', `${path}.data`);
  reqStr(data, 'group', `${path}.data`);
  reqObj(data, 'damage', `${path}.data`);
  reqInt(data, 'bulk', `${path}.data`, 0);
  reqInt(data, 'hands', `${path}.data`, 1);
  reqStrArray(data, 'traits', `${path}.data`);
  reqObj(data, 'price', `${path}.data`);
}

function validatePf2eSpell(record: RulesRecord, path: string): void {
  const data = dataObj(record, path);
  reqInt(data, 'rank', `${path}.data`, 0);
  reqStrArray(data, 'traditions', `${path}.data`);
  reqStrArray(data, 'traits', `${path}.data`);
  reqInt(data, 'castingActions', `${path}.data`, 0);
  reqStr(data, 'range', `${path}.data`);
  reqStr(data, 'duration', `${path}.data`);
  optStr(data, 'area', `${path}.data`);
  optBool(data, 'cantrip', `${path}.data`);
  reqStr(data, 'description', `${path}.data`);
}

const SYSTEM_KIND_VALIDATORS: Record<
  string,
  Partial<Record<RulesRecordKind, Validator>>
> = {
  'dnd5e-srd': {
    spell: validateDnd5eSpell,
    creature: validateDnd5eCreature,
    class: validateDnd5eClass,
    condition: validateDnd5eCondition,
  },
  'pathfinder2e-remaster': {
    ancestry: validatePf2eAncestry,
    background: validatePf2eBackground,
    class: validatePf2eClass,
    feat: validatePf2eFeat,
    equipment: validatePf2eEquipment,
    spell: validatePf2eSpell,
  },
};

/**
 * Validate that a rules record's `data` payload matches the schema for its
 * kind (and, if registered, its system+kind combination). Throws
 * `RulesPackError` on the first mismatch.
 */
export function validateRecordKindSchema(
  record: RulesRecord,
  path: string,
): void {
  BASE_KIND_VALIDATORS[record.kind](record, path);
  const systemValidator =
    SYSTEM_KIND_VALIDATORS[record.systemId]?.[record.kind];
  systemValidator?.(record, path);
}
