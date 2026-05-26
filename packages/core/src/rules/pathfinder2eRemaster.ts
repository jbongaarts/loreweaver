import type {
  RecordProvenance,
  RulesPack,
  RulesPackLicense,
  RulesPackMeta,
  RulesPackSource,
  RulesRecord,
} from './types.js';

const PF2E_SYSTEM_ID = 'pathfinder2e-remaster';
const PF2E_PACK_ID = 'rules:pathfinder2e-remaster';
const PF2E_VERSION = '1.0';
const PF2E_SOURCE_IDENTITY = 'pathfinder2e-remaster:fixture';

const PF2E_SOURCE: RulesPackSource = {
  sourceTitle: 'Pathfinder Second Edition Remaster Reference (fixture)',
  sourceVersion: PF2E_VERSION,
  sourceIdentity: PF2E_SOURCE_IDENTITY,
  recordProvenancePolicy:
    'Records cite the Player Core / GM Core / Monster Core section that defines the element; locators stay coarse while this fixture stands in for a full ORC import.',
};

const PF2E_PROVENANCE_FIXTURE: RecordProvenance = {
  sourceRef: PF2E_SOURCE_IDENTITY,
  locator: 'fixture',
  note: 'Placeholder pending the full ORC importer (loreweaver-0m9.8).',
};

const PF2E_LICENSE: RulesPackLicense = {
  licenseClass: 'open',
  licenseName: 'Open RPG Creative License (ORC)',
  attributionText:
    'This work includes mechanical rules elements derived from Pathfinder Second Edition Remaster reference material released under the Open RPG Creative License (ORC).',
  requiresAttribution: true,
  commercialUseAllowed: true,
  hostedUseAllowed: true,
  redistributionAllowed: true,
  publicSharingAllowed: true,
  derivativeAllowed: true,
  containsUserSuppliedText: false,
  containsTrademarkedSettingMaterial: false,
  sourceMaterialDescription:
    'Pathfinder Second Edition Remaster reference rules elements released under the Open RPG Creative License (ORC).',
  provenancePolicy:
    'Every record carries an ORC attribution and identifies the Pathfinder 2e Remaster reference source.',
  outputRestrictions:
    'Preserve ORC attribution on redistributed records. Do not include Paizo trade dress, compatibility logos, or reserved setting material.',
};

const SOURCE_LABEL = 'Pathfinder 2e Remaster Reference (ORC fixture)';

function record(
  record: Omit<RulesRecord, 'systemId' | 'source' | 'license' | 'provenance'>,
): RulesRecord {
  return {
    systemId: PF2E_SYSTEM_ID,
    source: SOURCE_LABEL,
    license: PF2E_LICENSE,
    provenance: PF2E_PROVENANCE_FIXTURE,
    ...record,
  };
}

const ANCESTRY_HUMAN: RulesRecord = record({
  kind: 'ancestry',
  key: 'ancestry:human',
  name: 'Human',
  data: {
    hitPoints: 8,
    size: 'Medium',
    speed: 25,
    languages: { granted: ['Common'], bonus: 'one additional language' },
    abilityBoosts: { free: 2 },
    traits: ['Humanoid', 'Human'],
  },
});

const BACKGROUND_ACOLYTE: RulesRecord = record({
  kind: 'background',
  key: 'background:acolyte',
  name: 'Acolyte',
  data: {
    abilityBoosts: {
      choices: [['Intelligence', 'Wisdom']],
      free: 1,
    },
    skillTraining: ['Religion'],
    skillFeat: 'Student of the Canon',
    loreTraining: 'Scribing Lore',
  },
});

const CLASS_FIGHTER: RulesRecord = record({
  kind: 'class',
  key: 'class:fighter',
  name: 'Fighter',
  data: {
    keyAbility: { choices: ['Strength', 'Dexterity'] },
    hitPointsPerLevel: 10,
    initialProficiencies: {
      perception: 'expert',
      savingThrows: { fortitude: 'expert', reflex: 'expert', will: 'trained' },
      attacks: {
        simple: 'expert',
        martial: 'expert',
        advanced: 'trained',
        unarmed: 'expert',
      },
      defenses: {
        unarmored: 'trained',
        light: 'trained',
        medium: 'trained',
        heavy: 'trained',
      },
      classDc: 'trained',
    },
    skills: { trained: 3, plusIntelligence: true },
    classFeats: { firstLevel: 1 },
  },
});

const FEAT_REACTIVE_STRIKE: RulesRecord = record({
  kind: 'feat',
  key: 'feat:reactive-strike',
  name: 'Reactive Strike',
  data: {
    level: 1,
    traits: ['Fighter'],
    actionCost: 'reaction',
    trigger:
      'A creature within your reach uses a manipulate action or a move action, makes a ranged attack, or leaves a square during a move action it is using.',
    effect:
      'Make a melee Strike against the triggering creature. If the attack interrupts the triggering action, you may disrupt that action on a hit.',
  },
});

const FEAT_NATURAL_AMBITION: RulesRecord = record({
  kind: 'feat',
  key: 'feat:natural-ambition',
  name: 'Natural Ambition',
  data: {
    level: 1,
    traits: ['Human'],
    actionCost: null,
    effect:
      'You were raised with ambition. You gain a 1st-level class feat for your class. You must satisfy any prerequisites.',
  },
});

const EQUIPMENT_LONGSWORD: RulesRecord = record({
  kind: 'equipment',
  key: 'equipment:longsword',
  name: 'Longsword',
  data: {
    category: 'martial',
    group: 'sword',
    damage: { dice: '1d8', type: 'slashing' },
    bulk: 1,
    hands: 1,
    traits: ['Versatile P'],
    price: { value: 1, currency: 'gp' },
  },
});

const SPELL_DETECT_MAGIC: RulesRecord = record({
  kind: 'spell',
  key: 'spell:detect-magic',
  name: 'Detect Magic',
  data: {
    rank: 1,
    traditions: ['Arcane', 'Divine', 'Occult', 'Primal'],
    traits: ['Cantrip', 'Concentrate', 'Detection'],
    castingActions: 2,
    range: '30 feet',
    area: '30-foot emanation',
    duration: 'instantaneous',
    cantrip: true,
    description:
      'You send out a pulse that registers the presence of magic. You receive no information beyond whether or not magic is present, and the pulse is blocked by lead.',
  },
});

const PF2E_META: RulesPackMeta = {
  packId: PF2E_PACK_ID,
  title: 'Pathfinder 2e Remaster Core Fixture',
  description:
    'Compact ORC-licensed fixture covering the broad record kinds needed for level-1 Pathfinder 2e Remaster character creation tests.',
  role: 'base',
  systemId: PF2E_SYSTEM_ID,
  version: PF2E_VERSION,
  license: PF2E_LICENSE,
  source: PF2E_SOURCE,
};

export const PATHFINDER2E_REMASTER_RULES_PACK: RulesPack = {
  meta: PF2E_META,
  records: [
    ANCESTRY_HUMAN,
    BACKGROUND_ACOLYTE,
    CLASS_FIGHTER,
    FEAT_REACTIVE_STRIKE,
    FEAT_NATURAL_AMBITION,
    EQUIPMENT_LONGSWORD,
    SPELL_DETECT_MAGIC,
  ],
};
