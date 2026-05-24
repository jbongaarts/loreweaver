import { describe, expect, it } from 'vitest';
import {
  PATHFINDER2E_REMASTER_RULES_PACK,
  PathfinderCharacterCreationError,
  completeCharacterCreation,
  initSchema,
  openDatabase,
  validatePathfinderCharacterDraft,
  writeCampaignRulesBinding,
} from '../src/internal.js';
import type { PathfinderCharacterDraft } from '../src/internal.js';

const VALID_DRAFT: PathfinderCharacterDraft = {
  name: 'Vesna',
  ancestry: 'Human',
  background: 'Acolyte',
  className: 'Fighter',
  level: 1,
  abilityScores: {
    strength: 18,
    dexterity: 14,
    constitution: 14,
    intelligence: 12,
    wisdom: 12,
    charisma: 10,
  },
  // Human (8) + Fighter (10) + Con +2 = 20
  maxHitPoints: 20,
  classFeat: 'Reactive Strike',
  ancestryFeat: 'Natural Ambition',
  equipment: ['Longsword'],
  spells: [],
};

function pathfinderDb(): ReturnType<typeof openDatabase> {
  const db = openDatabase(':memory:');
  initSchema(db);
  writeCampaignRulesBinding(db, {
    base: {
      systemId: PATHFINDER2E_REMASTER_RULES_PACK.meta.systemId,
      packId: PATHFINDER2E_REMASTER_RULES_PACK.meta.packId,
      version: PATHFINDER2E_REMASTER_RULES_PACK.meta.version,
    },
    addons: [],
    resolvedAt: '2026-05-23T13:00:00.000Z',
  });
  return db;
}

describe('Pathfinder character creation - happy path', () => {
  it('validates a broad level-1 Pathfinder draft', () => {
    const result = validatePathfinderCharacterDraft(VALID_DRAFT);
    expect(result.ok).toBe(true);
    expect(result.character.className).toBe('Fighter');
    expect(result.character.ancestry).toBe('Human');
    expect(result.character.background).toBe('Acolyte');
    expect(result.character.maxHitPoints).toBe(20);
    expect(result.character.classFeat).toBe('Reactive Strike');
    expect(result.character.ancestryFeat).toBe('Natural Ambition');
    expect(result.character.equipment).toEqual(['Longsword']);
    expect(result.character.spells).toEqual([]);
  });

  it('persists a valid Pathfinder draft through completeCharacterCreation', () => {
    const db = pathfinderDb();
    const result = completeCharacterCreation(db, {
      draft: VALID_DRAFT,
      sessionId: 'session-0',
      at: '2026-05-23T13:00:00.000Z',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.character.className).toBe('Fighter');
    }

    const row = db
      .prepare(
        `SELECT name, ancestry, class_name, level, hp_current, hp_max,
                ability_scores_json
         FROM character WHERE id = 1`,
      )
      .get() as {
      name: string;
      ancestry: string;
      class_name: string;
      level: number;
      hp_current: number;
      hp_max: number;
      ability_scores_json: string;
    };
    expect(row.name).toBe('Vesna');
    expect(row.ancestry).toBe('Human');
    expect(row.class_name).toBe('Fighter');
    expect(row.level).toBe(1);
    expect(row.hp_current).toBe(20);
    expect(row.hp_max).toBe(20);
    expect(JSON.parse(row.ability_scores_json).strength).toBeGreaterThanOrEqual(
      16,
    );
    db.close();
  });
});

describe('Pathfinder character creation - invalid drafts', () => {
  it('rejects an unknown ancestry', () => {
    expect(() =>
      validatePathfinderCharacterDraft({ ...VALID_DRAFT, ancestry: 'Elf' }),
    ).toThrow(PathfinderCharacterCreationError);
  });

  it('rejects an unknown class', () => {
    expect(() =>
      validatePathfinderCharacterDraft({
        ...VALID_DRAFT,
        className: 'Sorcerer',
      }),
    ).toThrow(PathfinderCharacterCreationError);
  });

  it('rejects an unknown background', () => {
    expect(() =>
      validatePathfinderCharacterDraft({
        ...VALID_DRAFT,
        background: 'Charlatan',
      }),
    ).toThrow(PathfinderCharacterCreationError);
  });

  it('rejects an ability score outside the level-1 bounds', () => {
    expect(() =>
      validatePathfinderCharacterDraft({
        ...VALID_DRAFT,
        abilityScores: { ...VALID_DRAFT.abilityScores, strength: 20 },
      }),
    ).toThrow(PathfinderCharacterCreationError);
  });

  it('rejects an ability score total that is implausibly low or high', () => {
    expect(() =>
      validatePathfinderCharacterDraft({
        ...VALID_DRAFT,
        abilityScores: {
          strength: 8,
          dexterity: 8,
          constitution: 8,
          intelligence: 8,
          wisdom: 8,
          charisma: 8,
        },
      }),
    ).toThrow(PathfinderCharacterCreationError);
  });

  it('rejects a missing class feat', () => {
    expect(() =>
      validatePathfinderCharacterDraft({ ...VALID_DRAFT, classFeat: '' }),
    ).toThrow(PathfinderCharacterCreationError);
  });

  it('rejects a class feat that is not a known feat record', () => {
    expect(() =>
      validatePathfinderCharacterDraft({
        ...VALID_DRAFT,
        classFeat: 'Power Attack',
      }),
    ).toThrow(PathfinderCharacterCreationError);
  });

  it('rejects an HP value that does not match ancestry + class + Con mod', () => {
    expect(() =>
      validatePathfinderCharacterDraft({ ...VALID_DRAFT, maxHitPoints: 12 }),
    ).toThrow(PathfinderCharacterCreationError);
  });

  it('rejects level > 1', () => {
    expect(() =>
      validatePathfinderCharacterDraft({ ...VALID_DRAFT, level: 2 }),
    ).toThrow(PathfinderCharacterCreationError);
  });

  it('rejects equipment items not in the Pathfinder rules pack', () => {
    expect(() =>
      validatePathfinderCharacterDraft({
        ...VALID_DRAFT,
        equipment: ['Plasma Rifle'],
      }),
    ).toThrow(PathfinderCharacterCreationError);
  });

  it('rejects a non-empty spell list for a non-caster class like Fighter', () => {
    expect(() =>
      validatePathfinderCharacterDraft({
        ...VALID_DRAFT,
        spells: ['Detect Magic'],
      }),
    ).toThrow(PathfinderCharacterCreationError);
  });
});
