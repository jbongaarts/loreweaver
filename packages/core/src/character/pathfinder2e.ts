/**
 * Pathfinder 2e Remaster character draft validator (level 1).
 *
 * This validator favors broad, playable level-1 coverage over advancement
 * mechanics. It checks identity (ancestry/background/class are records in the
 * bundled Pathfinder rules pack), ability scores (per-ability bounds and a
 * generous total sanity range), HP (ancestry + class/level + Con modifier),
 * required feat choices (class feat, ancestry feat), starting equipment, and
 * — for non-caster classes — that no spells were selected.
 */

import type { AbilityScoreName, AbilityScores } from '../characterCreation.js';
import { lookupRulesRecord } from '../rules/lookup.js';
import { PATHFINDER2E_REMASTER_RULES_PACK } from '../rules/pathfinder2eRemaster.js';
import type { ResolvedRulesStack } from '../rules/stack.js';
import { resolveRulesStack } from '../rules/stack.js';
import type { RulesRecordKind } from '../rules/types.js';

const ABILITY_SCORE_NAMES: readonly AbilityScoreName[] = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];

const MIN_ABILITY = 8;
const MAX_ABILITY = 18;
const MIN_ABILITY_TOTAL = 66;
const MAX_ABILITY_TOTAL = 84;

export interface PathfinderCharacterDraft {
  readonly name: string;
  readonly ancestry: string;
  readonly background: string;
  readonly className: string;
  readonly level: number;
  readonly abilityScores: AbilityScores;
  readonly maxHitPoints: number;
  readonly classFeat: string;
  readonly ancestryFeat: string;
  readonly equipment: readonly string[];
  readonly spells: readonly string[];
}

export interface CreatedPathfinderCharacter {
  readonly name: string;
  readonly ancestry: string;
  readonly background: string;
  readonly className: string;
  readonly level: number;
  readonly abilityScores: AbilityScores;
  readonly maxHitPoints: number;
  readonly classFeat: string;
  readonly ancestryFeat: string;
  readonly equipment: readonly string[];
  readonly spells: readonly string[];
}

export interface PathfinderCharacterCreationResult {
  readonly ok: true;
  readonly character: CreatedPathfinderCharacter;
}

export class PathfinderCharacterCreationError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(`Invalid Pathfinder character draft: ${errors.join('; ')}`);
    this.name = 'PathfinderCharacterCreationError';
    this.errors = errors;
  }
}

let cachedStack: ResolvedRulesStack | undefined;

function pathfinderStack(): ResolvedRulesStack {
  if (cachedStack === undefined) {
    cachedStack = resolveRulesStack({
      base: PATHFINDER2E_REMASTER_RULES_PACK,
    });
  }
  return cachedStack;
}

interface AncestryData {
  readonly hitPoints: number;
}

interface ClassData {
  readonly hitPointsPerLevel: number;
}

function lookupOfKind(
  stack: ResolvedRulesStack,
  kind: RulesRecordKind,
  name: string,
):
  | { ok: true; data: unknown; recordName: string; traits: readonly string[] }
  | { ok: false } {
  const result = lookupRulesRecord(stack, { kind, name });
  if (!result.ok) {
    return { ok: false };
  }
  const data = result.record.data as Record<string, unknown> | undefined;
  const traitsRaw = data?.traits;
  const traits = Array.isArray(traitsRaw)
    ? traitsRaw.filter((t): t is string => typeof t === 'string')
    : [];
  return {
    ok: true,
    data: result.record.data,
    recordName: result.record.name,
    traits,
  };
}

export function validatePathfinderCharacterDraft(
  draft: PathfinderCharacterDraft,
): PathfinderCharacterCreationResult {
  const errors: string[] = [];
  const stack = pathfinderStack();

  validateIdentity(draft, errors);
  const ancestryData = validateAncestry(draft, stack, errors);
  validateBackground(draft, stack, errors);
  const classData = validateClass(draft, stack, errors);
  validateAbilityScores(draft, errors);
  validateFeat('class feat', draft.classFeat, draft.className, stack, errors);
  validateFeat(
    'ancestry feat',
    draft.ancestryFeat,
    draft.ancestry,
    stack,
    errors,
  );
  validateEquipment(draft, stack, errors);
  validateSpells(draft, stack, errors);
  validateHitPoints(draft, ancestryData, classData, errors);

  if (errors.length > 0) {
    throw new PathfinderCharacterCreationError(errors);
  }

  return {
    ok: true,
    character: {
      name: draft.name.trim(),
      ancestry: draft.ancestry.trim(),
      background: draft.background.trim(),
      className: draft.className.trim(),
      level: draft.level,
      abilityScores: draft.abilityScores,
      maxHitPoints: draft.maxHitPoints,
      classFeat: draft.classFeat.trim(),
      ancestryFeat: draft.ancestryFeat.trim(),
      equipment: [...draft.equipment],
      spells: [...draft.spells],
    },
  };
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined;
}

function validateIdentity(
  draft: PathfinderCharacterDraft,
  errors: string[],
): void {
  if (nonEmptyString(draft.name) === undefined) {
    errors.push('character name is required');
  }
  if (draft.level !== 1) {
    errors.push(
      'Pathfinder character creation currently supports level 1 only',
    );
  }
}

function validateAncestry(
  draft: PathfinderCharacterDraft,
  stack: ResolvedRulesStack,
  errors: string[],
): AncestryData {
  const name = nonEmptyString(draft.ancestry);
  if (name === undefined) {
    errors.push('Pathfinder ancestry is required');
    return { hitPoints: 0 };
  }
  const result = lookupOfKind(stack, 'ancestry', name);
  if (!result.ok) {
    errors.push(`unsupported Pathfinder ancestry: ${name}`);
    return { hitPoints: 0 };
  }
  const data = (result.data as { hitPoints?: unknown }) ?? {};
  return {
    hitPoints: typeof data.hitPoints === 'number' ? data.hitPoints : 0,
  };
}

function validateBackground(
  draft: PathfinderCharacterDraft,
  stack: ResolvedRulesStack,
  errors: string[],
): void {
  const name = nonEmptyString(draft.background);
  if (name === undefined) {
    errors.push('Pathfinder background is required');
    return;
  }
  const result = lookupOfKind(stack, 'background', name);
  if (!result.ok) {
    errors.push(`unsupported Pathfinder background: ${name}`);
  }
}

function validateClass(
  draft: PathfinderCharacterDraft,
  stack: ResolvedRulesStack,
  errors: string[],
): ClassData {
  const name = nonEmptyString(draft.className);
  if (name === undefined) {
    errors.push('Pathfinder class is required');
    return { hitPointsPerLevel: 0 };
  }
  const result = lookupOfKind(stack, 'class', name);
  if (!result.ok) {
    errors.push(`unsupported Pathfinder class: ${name}`);
    return { hitPointsPerLevel: 0 };
  }
  const data = (result.data as { hitPointsPerLevel?: unknown }) ?? {};
  return {
    hitPointsPerLevel:
      typeof data.hitPointsPerLevel === 'number' ? data.hitPointsPerLevel : 0,
  };
}

function validateAbilityScores(
  draft: PathfinderCharacterDraft,
  errors: string[],
): void {
  if (typeof draft.abilityScores !== 'object' || draft.abilityScores === null) {
    errors.push('abilityScores object is required');
    return;
  }
  let total = 0;
  for (const name of ABILITY_SCORE_NAMES) {
    const score = draft.abilityScores[name];
    if (!Number.isInteger(score)) {
      errors.push(`${name} score must be an integer`);
      return;
    }
    if (score < MIN_ABILITY || score > MAX_ABILITY) {
      errors.push(
        `${name} score must be between ${MIN_ABILITY} and ${MAX_ABILITY} at level 1: ${score}`,
      );
    }
    total += score;
  }
  if (total < MIN_ABILITY_TOTAL || total > MAX_ABILITY_TOTAL) {
    errors.push(
      `ability score total ${total} is outside the plausible level-1 range [${MIN_ABILITY_TOTAL}, ${MAX_ABILITY_TOTAL}]`,
    );
  }
}

function validateFeat(
  label: string,
  featName: string | undefined,
  requiredTrait: string | undefined,
  stack: ResolvedRulesStack,
  errors: string[],
): void {
  const name = nonEmptyString(featName);
  if (name === undefined) {
    errors.push(`${label} is required`);
    return;
  }
  const result = lookupOfKind(stack, 'feat', name);
  if (!result.ok) {
    errors.push(`unsupported Pathfinder ${label}: ${name}`);
    return;
  }
  if (
    requiredTrait !== undefined &&
    nonEmptyString(requiredTrait) !== undefined &&
    !result.traits.includes(requiredTrait)
  ) {
    errors.push(
      `${label} ${result.recordName} must carry the ${requiredTrait} trait`,
    );
  }
}

function validateEquipment(
  draft: PathfinderCharacterDraft,
  stack: ResolvedRulesStack,
  errors: string[],
): void {
  const items = Array.isArray(draft.equipment) ? draft.equipment : [];
  for (const item of items) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      errors.push('equipment entries must be non-empty strings');
      continue;
    }
    if (!lookupOfKind(stack, 'equipment', item).ok) {
      errors.push(`unsupported Pathfinder equipment: ${item}`);
    }
  }
}

function validateSpells(
  draft: PathfinderCharacterDraft,
  stack: ResolvedRulesStack,
  errors: string[],
): void {
  const spells = Array.isArray(draft.spells) ? draft.spells : [];
  if (spells.length === 0) {
    return;
  }
  if (!classHasSpellcasting(draft.className ?? '')) {
    errors.push(
      `${draft.className ?? 'this class'} does not have spellcasting; remove the spell list`,
    );
    return;
  }
  for (const spell of spells) {
    if (typeof spell !== 'string' || spell.trim().length === 0) {
      errors.push('spell entries must be non-empty strings');
      continue;
    }
    if (!lookupOfKind(stack, 'spell', spell).ok) {
      errors.push(`unsupported Pathfinder spell: ${spell}`);
    }
  }
}

function classHasSpellcasting(className: string): boolean {
  // The fixture's Fighter has no spellcasting. Casters added later (Wizard,
  // Sorcerer, Cleric, etc.) should opt in here once their records exist.
  return false;
}

function validateHitPoints(
  draft: PathfinderCharacterDraft,
  ancestry: AncestryData,
  klass: ClassData,
  errors: string[],
): void {
  if (ancestry.hitPoints === 0 || klass.hitPointsPerLevel === 0) {
    return; // earlier errors will already surface the missing record
  }
  const conMod = abilityModifier(draft.abilityScores.constitution);
  const expected = ancestry.hitPoints + klass.hitPointsPerLevel + conMod;
  if (draft.maxHitPoints !== expected) {
    errors.push(
      `level-1 hit point maximum must be ${expected} (ancestry ${ancestry.hitPoints} + class ${klass.hitPointsPerLevel} + Con mod ${conMod})`,
    );
  }
}

function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}
