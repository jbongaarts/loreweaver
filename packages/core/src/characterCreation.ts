import {
  PathfinderCharacterCreationError,
  validatePathfinderCharacterDraft,
} from './character/pathfinder2e.js';
import type {
  CreatedPathfinderCharacter,
  PathfinderCharacterDraft,
} from './character/pathfinder2e.js';
import type { Db } from './persistence/db.js';
import {
  DEFAULT_DND5E_SRD_BINDING,
  readCampaignRulesBinding,
} from './rules/binding.js';
import { SRD_CATALOG } from './srd/data.js';
import { lookupSrdRecord } from './srd/store.js';
import type {
  SrdCatalog,
  SrdClassRecord,
  SrdRecord,
  SrdSpellRecord,
} from './srd/types.js';
import {
  type MutateStateInput,
  mutateStateBatch,
} from './state/mutateState.js';

/**
 * The rules system the character creator is dispatching for. The string set
 * mirrors the `systemId` field on bundled rules packs; unsupported systems
 * surface a correction response rather than a thrown error.
 */
export type CharacterCreationSystem = 'dnd5e-srd' | 'pathfinder2e-remaster';

export type AbilityScoreName =
  | 'strength'
  | 'dexterity'
  | 'constitution'
  | 'intelligence'
  | 'wisdom'
  | 'charisma';

export type AbilityScoreMethod = 'point_buy' | 'standard_array';

export type AbilityScores = Readonly<Record<AbilityScoreName, number>>;

export interface CharacterCreationDraft {
  readonly name: string;
  readonly ancestry: string;
  readonly className: string;
  readonly level: number;
  readonly abilityScoreMethod: AbilityScoreMethod;
  readonly abilityScores: AbilityScores;
  readonly maxHitPoints: number;
  readonly spells: readonly string[];
}

export interface CreatedCharacter {
  readonly name: string;
  readonly ancestry: string;
  readonly className: string;
  readonly level: number;
  readonly abilityScores: AbilityScores;
  readonly maxHitPoints: number;
  readonly spells: readonly string[];
}

export interface CharacterCreationResult {
  readonly ok: true;
  readonly character: CreatedCharacter;
}

export interface CharacterCreationMutationMetadata {
  readonly provenance: string;
  readonly sessionId: string;
  readonly at: string;
}

export interface CompleteCharacterCreationInput {
  readonly draft: CharacterCreationDraft | PathfinderCharacterDraft;
  readonly sessionId: string;
  readonly at: string;
  readonly provenance?: string;
}

export type CompleteCharacterCreationResult =
  | {
      readonly ok: true;
      readonly character: CreatedCharacter;
      readonly mutationsApplied: number;
      readonly prompt: string;
    }
  | {
      readonly ok: false;
      readonly errors: readonly string[];
      readonly prompt: string;
    };

const ABILITY_SCORE_NAMES: readonly AbilityScoreName[] = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];

const POINT_BUY_COSTS = new Map([
  [8, 0],
  [9, 1],
  [10, 2],
  [11, 3],
  [12, 4],
  [13, 5],
  [14, 7],
  [15, 9],
]);

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;
const SRD_ANCESTRIES = new Set(['Human']);

export class CharacterCreationError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(`Invalid character creation draft: ${errors.join('; ')}`);
    this.name = 'CharacterCreationError';
    this.errors = errors;
  }
}

export function validateCharacterDraft(
  draft: CharacterCreationDraft,
  catalog: SrdCatalog = SRD_CATALOG,
): CharacterCreationResult {
  const errors: string[] = [];
  const characterClass = validateClass(draft, catalog, errors);
  validateIdentity(draft, errors);
  validateAbilityScores(draft, errors);
  validateHitPoints(draft, characterClass, errors);
  validateSpells(draft, characterClass.name, catalog, errors);

  if (errors.length > 0) {
    throw new CharacterCreationError(errors);
  }

  return {
    ok: true,
    character: {
      name: draft.name.trim(),
      ancestry: draft.ancestry.trim(),
      className: characterClass.name,
      level: draft.level,
      abilityScores: draft.abilityScores,
      maxHitPoints: draft.maxHitPoints,
      spells: [...draft.spells],
    },
  };
}

export function buildCharacterCreationMutations(
  draft: CharacterCreationDraft,
  metadata: CharacterCreationMutationMetadata,
  catalog: SrdCatalog = SRD_CATALOG,
): MutateStateInput[] {
  const { character } = validateCharacterDraft(draft, catalog);
  return characterMutations(character, metadata);
}

export function completeCharacterCreation(
  db: Db,
  input: CompleteCharacterCreationInput,
  catalog: SrdCatalog = SRD_CATALOG,
): CompleteCharacterCreationResult {
  const system = resolveCampaignSystem(db);

  if (system === 'pathfinder2e-remaster') {
    return completePathfinderCharacterCreation(db, input);
  }

  if (system !== 'dnd5e-srd') {
    return correctionResult([
      `character creation for rules system '${system}' is not yet implemented`,
    ]);
  }

  try {
    const { character } = validateCharacterDraft(
      input.draft as CharacterCreationDraft,
      catalog,
    );

    const metadata = {
      provenance: input.provenance ?? 'character_creation:complete',
      sessionId: input.sessionId,
      at: input.at,
    };
    const mutations = characterMutations(character, metadata);
    mutateStateBatch(db, mutations);

    return {
      ok: true,
      character,
      mutationsApplied: mutations.length,
      prompt: completionPrompt(character),
    };
  } catch (error) {
    if (error instanceof CharacterCreationError) {
      return correctionResult(error.errors);
    }

    throw error;
  }
}

function completePathfinderCharacterCreation(
  db: Db,
  input: CompleteCharacterCreationInput,
): CompleteCharacterCreationResult {
  try {
    const { character } = validatePathfinderCharacterDraft(
      input.draft as PathfinderCharacterDraft,
    );

    const metadata = {
      provenance: input.provenance ?? 'character_creation:complete',
      sessionId: input.sessionId,
      at: input.at,
    };
    const mutations = pathfinderCharacterMutations(character, metadata);
    mutateStateBatch(db, mutations);

    const projection: CreatedCharacter = {
      name: character.name,
      ancestry: character.ancestry,
      className: character.className,
      level: character.level,
      abilityScores: character.abilityScores,
      maxHitPoints: character.maxHitPoints,
      spells: character.spells,
    };

    return {
      ok: true,
      character: projection,
      mutationsApplied: mutations.length,
      prompt: pathfinderCompletionPrompt(character),
    };
  } catch (error) {
    if (error instanceof PathfinderCharacterCreationError) {
      return correctionResult(error.errors);
    }
    throw error;
  }
}

function pathfinderCharacterMutations(
  character: CreatedPathfinderCharacter,
  metadata: CharacterCreationMutationMetadata,
): MutateStateInput[] {
  const base = {
    target: 'character',
    op: 'set',
    provenance: metadata.provenance,
    sessionId: metadata.sessionId,
    at: metadata.at,
  } as const;

  return [
    { ...base, field: 'name', value: character.name },
    { ...base, field: 'ancestry', value: character.ancestry },
    { ...base, field: 'class_name', value: character.className },
    { ...base, field: 'level', value: character.level },
    { ...base, field: 'hp_current', value: character.maxHitPoints },
    { ...base, field: 'hp_max', value: character.maxHitPoints },
    {
      ...base,
      field: 'ability_scores_json',
      value: JSON.stringify(character.abilityScores),
    },
    { ...base, field: 'conditions_json', value: JSON.stringify([]) },
  ];
}

function pathfinderCompletionPrompt(
  character: CreatedPathfinderCharacter,
): string {
  return `Character creation complete: ${character.name} is a level ${character.level} ${character.ancestry} ${character.className} (${character.background}; class feat ${character.classFeat}, ancestry feat ${character.ancestryFeat}).`;
}

/**
 * Resolve the rules system from the campaign's persisted binding, falling
 * back to D&D SRD when no binding row exists (legacy DBs at the current
 * schema version). Unknown systems surface as the raw systemId string so the
 * dispatcher can produce a clear correction message.
 */
function resolveCampaignSystem(db: Db): string {
  const binding = readCampaignRulesBinding(db) ?? DEFAULT_DND5E_SRD_BINDING;
  return binding.base.systemId;
}

function validateIdentity(
  draft: CharacterCreationDraft,
  errors: string[],
): void {
  if (draft.name.trim().length === 0) {
    errors.push('character name is required');
  }
  if (!SRD_ANCESTRIES.has(draft.ancestry.trim())) {
    errors.push(`unsupported SRD ancestry: ${draft.ancestry}`);
  }
  if (draft.level !== 1) {
    errors.push('character creation currently supports level 1 only');
  }
}

function correctionResult(
  errors: readonly string[],
): CompleteCharacterCreationResult {
  return {
    ok: false,
    errors,
    prompt: `Revise the character draft before persisting it: ${errors.join('; ')}`,
  };
}

function completionPrompt(character: CreatedCharacter): string {
  return `Character creation complete: ${character.name} is a level ${character.level} ${character.ancestry} ${character.className}.`;
}

function characterMutations(
  character: CreatedCharacter,
  metadata: CharacterCreationMutationMetadata,
): MutateStateInput[] {
  const base = {
    target: 'character',
    op: 'set',
    provenance: metadata.provenance,
    sessionId: metadata.sessionId,
    at: metadata.at,
  } as const;

  return [
    { ...base, field: 'name', value: character.name },
    { ...base, field: 'ancestry', value: character.ancestry },
    { ...base, field: 'class_name', value: character.className },
    { ...base, field: 'level', value: character.level },
    { ...base, field: 'hp_current', value: character.maxHitPoints },
    { ...base, field: 'hp_max', value: character.maxHitPoints },
    {
      ...base,
      field: 'ability_scores_json',
      value: JSON.stringify(character.abilityScores),
    },
    { ...base, field: 'conditions_json', value: JSON.stringify([]) },
  ];
}

function validateClass(
  draft: CharacterCreationDraft,
  catalog: SrdCatalog,
  errors: string[],
): SrdClassRecord {
  const result = lookupSrdRecord(
    { kind: 'class', name: draft.className },
    catalog,
  );
  if (!result.ok) {
    errors.push(`unsupported SRD class: ${draft.className}`);
    return fallbackClass();
  }

  return result.record as SrdClassRecord;
}

function validateAbilityScores(
  draft: CharacterCreationDraft,
  errors: string[],
): void {
  const scores = ABILITY_SCORE_NAMES.map((name) => draft.abilityScores[name]);
  if (scores.some((score) => !Number.isInteger(score))) {
    errors.push('ability scores must be integers');
    return;
  }

  if (draft.abilityScoreMethod === 'point_buy') {
    validatePointBuy(scores, errors);
    return;
  }

  validateStandardArray(scores, errors);
}

function validatePointBuy(scores: readonly number[], errors: string[]): void {
  let total = 0;
  for (const score of scores) {
    const cost = POINT_BUY_COSTS.get(score);
    if (cost === undefined) {
      errors.push(
        `point-buy score must be between 8 and 15 before bonuses: ${score}`,
      );
      return;
    }
    total += cost;
  }

  if (total > 27) {
    errors.push(`point-buy total exceeds 27: ${total}`);
  }
}

function validateStandardArray(
  scores: readonly number[],
  errors: string[],
): void {
  const actual = [...scores].sort((left, right) => right - left);
  if (!STANDARD_ARRAY.every((score, index) => actual[index] === score)) {
    errors.push('standard-array scores must be 15, 14, 13, 12, 10, and 8');
  }
}

function validateHitPoints(
  draft: CharacterCreationDraft,
  characterClass: SrdClassRecord,
  errors: string[],
): void {
  const expected =
    characterClass.hitDie + abilityModifier(draft.abilityScores.constitution);
  if (draft.maxHitPoints !== expected) {
    errors.push(`level-1 hit point maximum must be ${expected}`);
  }
}

function validateSpells(
  draft: Pick<CharacterCreationDraft, 'spells'>,
  className: string,
  catalog: SrdCatalog,
  errors: string[],
): void {
  for (const spellNameOrRef of draft.spells) {
    const result = spellNameOrRef.startsWith('spell:')
      ? lookupSrdRecord({ kind: 'spell', ref: spellNameOrRef }, catalog)
      : lookupSrdRecord({ kind: 'spell', name: spellNameOrRef }, catalog);

    if (!result.ok) {
      errors.push(`unsupported SRD spell: ${spellNameOrRef}`);
      continue;
    }

    const spell = asSpellRecord(result.record);
    if (!spell.classes.includes(className)) {
      errors.push(`${spell.name} is not legal for ${className}`);
    }
  }
}

function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

function fallbackClass(): SrdClassRecord {
  return {
    kind: 'class',
    ref: 'class:invalid',
    name: 'Invalid',
    hitDie: 0,
    primaryAbilities: [],
    savingThrowProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
  };
}

function asSpellRecord(record: SrdRecord): SrdSpellRecord {
  if (record.kind !== 'spell') {
    throw new CharacterCreationError([
      `expected spell SRD record: ${record.ref}`,
    ]);
  }

  return record;
}
