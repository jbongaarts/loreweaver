import type { PackLicense, PackLicenseClass } from '../world/types.js';

export type RulesPackRole = 'base' | 'addon';

export type RulesRecordKind =
  | 'ability'
  | 'action'
  | 'ancestry'
  | 'background'
  | 'class'
  | 'condition'
  | 'creature'
  | 'equipment'
  | 'feat'
  | 'hazard'
  | 'rule'
  | 'spell'
  | 'table';

export type RulesPackLicense = PackLicense;
export type RulesPackLicenseClass = PackLicenseClass;

export interface CompatibleBaseSystem {
  readonly systemId: string;
  readonly versions: readonly string[];
}

export interface RulesPackMeta {
  readonly packId: string;
  readonly title: string;
  readonly description: string;
  readonly role: RulesPackRole;
  readonly systemId: string;
  readonly version: string;
  readonly compatibleBaseSystems?: readonly CompatibleBaseSystem[];
  readonly order?: number;
  readonly dependsOn?: readonly string[];
  readonly license: RulesPackLicense;
}

export interface RulesRecord {
  readonly systemId: string;
  readonly kind: RulesRecordKind;
  readonly key: string;
  readonly name: string;
  readonly data: unknown;
  readonly source: string;
  readonly license: RulesPackLicense;
  readonly overrides?: readonly string[];
}

export interface RulesPack {
  readonly meta: RulesPackMeta;
  readonly records: readonly RulesRecord[];
}

export class RulesPackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RulesPackError';
  }
}
