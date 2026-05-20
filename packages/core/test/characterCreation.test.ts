import { describe, expect, it } from 'vitest';
import {
  buildCharacterCreationMutations,
  CharacterCreationError,
  validateCharacterDraft,
} from '../src/index.js';

const validDraft = {
  name: 'Mira',
  ancestry: 'Human',
  className: 'Fighter',
  level: 1,
  abilityScoreMethod: 'point_buy',
  abilityScores: {
    strength: 15,
    dexterity: 14,
    constitution: 14,
    intelligence: 10,
    wisdom: 10,
    charisma: 8,
  },
  maxHitPoints: 12,
  spells: [],
} as const;

describe('character creation', () => {
  it('validates an SRD-legal level-1 character draft', () => {
    expect(validateCharacterDraft(validDraft)).toEqual({
      ok: true,
      character: {
        name: 'Mira',
        ancestry: 'Human',
        className: 'Fighter',
        level: 1,
        abilityScores: validDraft.abilityScores,
        maxHitPoints: 12,
        spells: [],
      },
    });
  });

  it('rejects illegal class, point-buy, standard-array, and spell choices', () => {
    expect(() =>
      validateCharacterDraft({ ...validDraft, className: 'Warlock' }),
    ).toThrow(CharacterCreationError);

    expect(() =>
      validateCharacterDraft({
        ...validDraft,
        abilityScores: { ...validDraft.abilityScores, strength: 16 },
      }),
    ).toThrow(CharacterCreationError);

    expect(() =>
      validateCharacterDraft({
        ...validDraft,
        abilityScoreMethod: 'standard_array',
        abilityScores: {
          strength: 15,
          dexterity: 14,
          constitution: 13,
          intelligence: 12,
          wisdom: 10,
          charisma: 10,
        },
      }),
    ).toThrow(CharacterCreationError);

    expect(() =>
      validateCharacterDraft({
        ...validDraft,
        spells: ['Fire Bolt'],
      }),
    ).toThrow(CharacterCreationError);
  });

  it('builds mutate_state-compatible writes for the canonical character row', () => {
    expect(
      buildCharacterCreationMutations(validDraft, {
        provenance: 'character_creation:session-zero',
        sessionId: 'session-0',
        at: '2026-05-20T22:45:00.000Z',
      }),
    ).toEqual([
      {
        target: 'character',
        field: 'name',
        op: 'set',
        value: 'Mira',
        provenance: 'character_creation:session-zero',
        sessionId: 'session-0',
        at: '2026-05-20T22:45:00.000Z',
      },
      {
        target: 'character',
        field: 'ancestry',
        op: 'set',
        value: 'Human',
        provenance: 'character_creation:session-zero',
        sessionId: 'session-0',
        at: '2026-05-20T22:45:00.000Z',
      },
      {
        target: 'character',
        field: 'class_name',
        op: 'set',
        value: 'Fighter',
        provenance: 'character_creation:session-zero',
        sessionId: 'session-0',
        at: '2026-05-20T22:45:00.000Z',
      },
      {
        target: 'character',
        field: 'level',
        op: 'set',
        value: 1,
        provenance: 'character_creation:session-zero',
        sessionId: 'session-0',
        at: '2026-05-20T22:45:00.000Z',
      },
      {
        target: 'character',
        field: 'hp_current',
        op: 'set',
        value: 12,
        provenance: 'character_creation:session-zero',
        sessionId: 'session-0',
        at: '2026-05-20T22:45:00.000Z',
      },
      {
        target: 'character',
        field: 'hp_max',
        op: 'set',
        value: 12,
        provenance: 'character_creation:session-zero',
        sessionId: 'session-0',
        at: '2026-05-20T22:45:00.000Z',
      },
      {
        target: 'character',
        field: 'ability_scores_json',
        op: 'set',
        value: JSON.stringify(validDraft.abilityScores),
        provenance: 'character_creation:session-zero',
        sessionId: 'session-0',
        at: '2026-05-20T22:45:00.000Z',
      },
      {
        target: 'character',
        field: 'conditions_json',
        op: 'set',
        value: JSON.stringify([]),
        provenance: 'character_creation:session-zero',
        sessionId: 'session-0',
        at: '2026-05-20T22:45:00.000Z',
      },
    ]);
  });
});
