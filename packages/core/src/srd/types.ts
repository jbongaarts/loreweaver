export type SrdKind = 'monster' | 'spell' | 'class';

export interface SrdLicenseMetadata {
  readonly sourceTitle: string;
  readonly sourceVersion: string;
  readonly sourceUrl: string;
  readonly licenseName: string;
  readonly licenseUrl: string;
  readonly attribution: string;
}

export interface SrdBaseRecord {
  readonly kind: SrdKind;
  readonly ref: string;
  readonly name: string;
  readonly sourcePage?: number;
}

export interface SrdMonsterRecord extends SrdBaseRecord {
  readonly kind: 'monster';
  readonly size: string;
  readonly type: string;
  readonly alignment: string;
  readonly armorClass: number;
  readonly hitPoints: number;
  readonly speed: Readonly<Record<string, number>>;
  readonly challengeRating: string;
  readonly abilityScores: Readonly<{
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  }>;
}

export interface SrdSpellRecord extends SrdBaseRecord {
  readonly kind: 'spell';
  readonly level: number;
  readonly school: string;
  readonly castingTime: string;
  readonly range: string;
  readonly components: readonly string[];
  readonly duration: string;
  readonly classes: readonly string[];
}

export interface SrdClassRecord extends SrdBaseRecord {
  readonly kind: 'class';
  readonly hitDie: number;
  readonly primaryAbilities: readonly string[];
  readonly savingThrowProficiencies: readonly string[];
  readonly armorProficiencies: readonly string[];
  readonly weaponProficiencies: readonly string[];
}

export type SrdRecord = SrdMonsterRecord | SrdSpellRecord | SrdClassRecord;

export interface SrdCatalog {
  readonly monsters: readonly SrdMonsterRecord[];
  readonly spells: readonly SrdSpellRecord[];
  readonly classes: readonly SrdClassRecord[];
}

export type SrdLookupInput =
  | {
      readonly kind: SrdKind;
      readonly ref: string;
      readonly name?: never;
    }
  | {
      readonly kind: SrdKind;
      readonly name: string;
      readonly ref?: never;
    };

export type SrdLookupResult =
  | {
      readonly ok: true;
      readonly record: SrdRecord;
      readonly license: SrdLicenseMetadata;
    }
  | {
      readonly ok: false;
      readonly code: 'not_found';
      readonly message: string;
    };
