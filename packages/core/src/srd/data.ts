import type { SrdCatalog, SrdLicenseMetadata } from './types.js';

export const SRD_LICENSE: SrdLicenseMetadata = {
  sourceTitle: 'System Reference Document 5.1',
  sourceVersion: '5.1',
  sourceUrl:
    'https://media.dndbeyond.com/compendium-images/srd/5.1/SRD_CC_v5.1.pdf',
  licenseName: 'Creative Commons Attribution 4.0 International',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  attribution:
    'This work includes material from the System Reference Document 5.1 by Wizards of the Coast LLC, available under CC-BY-4.0.',
};

export const SRD_CATALOG: SrdCatalog = {
  monsters: [
    {
      kind: 'monster',
      ref: 'monster:goblin',
      name: 'Goblin',
      sourcePage: 310,
      size: 'Small',
      type: 'humanoid',
      alignment: 'neutral evil',
      armorClass: 15,
      hitPoints: 7,
      speed: { walk: 30 },
      challengeRating: '1/4',
      abilityScores: {
        strength: 8,
        dexterity: 14,
        constitution: 10,
        intelligence: 10,
        wisdom: 8,
        charisma: 8,
      },
    },
  ],
  spells: [
    {
      kind: 'spell',
      ref: 'spell:fire-bolt',
      name: 'Fire Bolt',
      sourcePage: 144,
      level: 0,
      school: 'evocation',
      castingTime: '1 action',
      range: '120 feet',
      components: ['V', 'S'],
      duration: 'Instantaneous',
      classes: ['Sorcerer', 'Wizard'],
    },
  ],
  classes: [
    {
      kind: 'class',
      ref: 'class:fighter',
      name: 'Fighter',
      sourcePage: 25,
      hitDie: 10,
      primaryAbilities: ['Strength', 'Dexterity'],
      savingThrowProficiencies: ['Strength', 'Constitution'],
      armorProficiencies: ['All armor', 'Shields'],
      weaponProficiencies: ['Simple weapons', 'Martial weapons'],
    },
  ],
};
