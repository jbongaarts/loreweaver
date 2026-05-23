import { SRD_CATALOG, SRD_LICENSE } from '../srd/data.js';
import type {
  SrdClassRecord,
  SrdMonsterRecord,
  SrdSpellRecord,
} from '../srd/types.js';
import type {
  RulesPack,
  RulesPackLicense,
  RulesPackMeta,
  RulesRecord,
} from './types.js';

const DND5E_SYSTEM_ID = 'dnd5e-srd';
const DND5E_PACK_ID = 'rules:dnd5e-srd';

const DND5E_LICENSE: RulesPackLicense = {
  licenseClass: 'open',
  licenseName: SRD_LICENSE.licenseName,
  attributionText: SRD_LICENSE.attribution,
  requiresAttribution: true,
  commercialUseAllowed: true,
  hostedUseAllowed: true,
  redistributionAllowed: true,
  publicSharingAllowed: true,
  derivativeAllowed: true,
  containsUserSuppliedText: false,
  containsTrademarkedSettingMaterial: false,
  sourceMaterialDescription: `${SRD_LICENSE.sourceTitle} (${SRD_LICENSE.sourceVersion}) at ${SRD_LICENSE.sourceUrl}`,
  provenancePolicy:
    'Every record names the SRD source page and ships under the CC-BY-4.0 license terms.',
  outputRestrictions:
    'Preserve the SRD 5.1 attribution text on redistributed records and derivatives.',
};

function sourceLabel(sourcePage: number | undefined): string {
  return sourcePage === undefined
    ? `${SRD_LICENSE.sourceTitle}`
    : `${SRD_LICENSE.sourceTitle} p. ${sourcePage}`;
}

function fromMonster(monster: SrdMonsterRecord): RulesRecord {
  return {
    systemId: DND5E_SYSTEM_ID,
    kind: 'creature',
    key: monster.ref,
    name: monster.name,
    data: {
      size: monster.size,
      type: monster.type,
      alignment: monster.alignment,
      armorClass: monster.armorClass,
      hitPoints: monster.hitPoints,
      speed: monster.speed,
      challengeRating: monster.challengeRating,
      abilityScores: monster.abilityScores,
    },
    source: sourceLabel(monster.sourcePage),
    license: DND5E_LICENSE,
  };
}

function fromSpell(spell: SrdSpellRecord): RulesRecord {
  return {
    systemId: DND5E_SYSTEM_ID,
    kind: 'spell',
    key: spell.ref,
    name: spell.name,
    data: {
      level: spell.level,
      school: spell.school,
      castingTime: spell.castingTime,
      range: spell.range,
      components: spell.components,
      duration: spell.duration,
      classes: spell.classes,
    },
    source: sourceLabel(spell.sourcePage),
    license: DND5E_LICENSE,
  };
}

function fromClass(klass: SrdClassRecord): RulesRecord {
  return {
    systemId: DND5E_SYSTEM_ID,
    kind: 'class',
    key: klass.ref,
    name: klass.name,
    data: {
      hitDie: klass.hitDie,
      primaryAbilities: klass.primaryAbilities,
      savingThrowProficiencies: klass.savingThrowProficiencies,
      armorProficiencies: klass.armorProficiencies,
      weaponProficiencies: klass.weaponProficiencies,
    },
    source: sourceLabel(klass.sourcePage),
    license: DND5E_LICENSE,
  };
}

const DND5E_META: RulesPackMeta = {
  packId: DND5E_PACK_ID,
  title: 'D&D 5e SRD 5.1 Rules Pack',
  description:
    'Provider-neutral rules pack adapting the bundled SRD 5.1 catalog to the cross-system rules model.',
  role: 'base',
  systemId: DND5E_SYSTEM_ID,
  version: SRD_LICENSE.sourceVersion,
  license: DND5E_LICENSE,
};

export const DND5E_SRD_RULES_PACK: RulesPack = {
  meta: DND5E_META,
  records: [
    ...SRD_CATALOG.monsters.map(fromMonster),
    ...SRD_CATALOG.spells.map(fromSpell),
    ...SRD_CATALOG.classes.map(fromClass),
  ],
};
