import type {
  CompatibleBaseSystem,
  RulesPack,
  RulesPackLicense,
  RulesPackMeta,
  RulesPackRole,
  RulesRecord,
  RulesRecordKind,
} from './types.js';
import { RulesPackError } from './types.js';

type Obj = Record<string, unknown>;

const RULES_PACK_ROLES: readonly RulesPackRole[] = ['base', 'addon'];
const RULES_RECORD_KINDS: readonly RulesRecordKind[] = [
  'ability',
  'action',
  'ancestry',
  'background',
  'class',
  'condition',
  'creature',
  'equipment',
  'feat',
  'hazard',
  'rule',
  'spell',
  'table',
];

function obj(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RulesPackError(`${path} must be an object`);
  }
  return value as Obj;
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RulesPackError(`${path} must be a non-empty string`);
  }
  return value;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new RulesPackError(`${path} must be a boolean`);
  }
  return value;
}

function arr(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new RulesPackError(`${path} must be an array`);
  }
  return value;
}

function strArray(value: unknown, path: string): string[] {
  return arr(value, path).map((item, i) => str(item, `${path}[${i}]`));
}

function oneOf<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  const s = str(value, path);
  if (!(allowed as readonly string[]).includes(s)) {
    throw new RulesPackError(`${path} must be one of: ${allowed.join(', ')}`);
  }
  return s as T;
}

function license(value: unknown, path: string): RulesPackLicense {
  const o = obj(value, path);
  return {
    licenseClass: oneOf(o.licenseClass, `${path}.licenseClass`, [
      'open',
      'public-domain',
      'original',
      'publisher-licensed',
      'user-private',
    ]),
    licenseName: str(o.licenseName, `${path}.licenseName`),
    attributionText: str(o.attributionText, `${path}.attributionText`),
    requiresAttribution: bool(
      o.requiresAttribution,
      `${path}.requiresAttribution`,
    ),
    commercialUseAllowed: bool(
      o.commercialUseAllowed,
      `${path}.commercialUseAllowed`,
    ),
    hostedUseAllowed: bool(o.hostedUseAllowed, `${path}.hostedUseAllowed`),
    redistributionAllowed: bool(
      o.redistributionAllowed,
      `${path}.redistributionAllowed`,
    ),
    publicSharingAllowed: bool(
      o.publicSharingAllowed,
      `${path}.publicSharingAllowed`,
    ),
    derivativeAllowed: bool(o.derivativeAllowed, `${path}.derivativeAllowed`),
    containsUserSuppliedText: bool(
      o.containsUserSuppliedText,
      `${path}.containsUserSuppliedText`,
    ),
    containsTrademarkedSettingMaterial: bool(
      o.containsTrademarkedSettingMaterial,
      `${path}.containsTrademarkedSettingMaterial`,
    ),
    sourceMaterialDescription: str(
      o.sourceMaterialDescription,
      `${path}.sourceMaterialDescription`,
    ),
    provenancePolicy: str(o.provenancePolicy, `${path}.provenancePolicy`),
    outputRestrictions: str(o.outputRestrictions, `${path}.outputRestrictions`),
  };
}

function compatibleBaseSystem(
  value: unknown,
  i: number,
): CompatibleBaseSystem {
  const path = `meta.compatibleBaseSystems[${i}]`;
  const o = obj(value, path);
  const versions = strArray(o.versions, `${path}.versions`);
  if (versions.length === 0) {
    throw new RulesPackError(`${path}.versions must not be empty`);
  }
  return {
    systemId: str(o.systemId, `${path}.systemId`),
    versions,
  };
}

function meta(value: unknown): RulesPackMeta {
  const o = obj(value, 'meta');
  const role = oneOf(o.role, 'meta.role', RULES_PACK_ROLES);
  const compatibleBaseSystems =
    o.compatibleBaseSystems === undefined
      ? undefined
      : arr(o.compatibleBaseSystems, 'meta.compatibleBaseSystems').map(
          compatibleBaseSystem,
        );

  if (role === 'addon' && (compatibleBaseSystems?.length ?? 0) === 0) {
    throw new RulesPackError(
      'meta.compatibleBaseSystems must declare at least one compatible base system for addon packs',
    );
  }

  return {
    packId: str(o.packId, 'meta.packId'),
    title: str(o.title, 'meta.title'),
    description: str(o.description, 'meta.description'),
    role,
    systemId: str(o.systemId, 'meta.systemId'),
    version: str(o.version, 'meta.version'),
    ...(compatibleBaseSystems === undefined ? {} : { compatibleBaseSystems }),
    license: license(o.license, 'meta.license'),
  };
}

function record(value: unknown, i: number): RulesRecord {
  const path = `records[${i}]`;
  const o = obj(value, path);
  return {
    systemId: str(o.systemId, `${path}.systemId`),
    kind: oneOf(o.kind, `${path}.kind`, RULES_RECORD_KINDS),
    key: str(o.key, `${path}.key`),
    name: str(o.name, `${path}.name`),
    data: o.data,
    source: str(o.source, `${path}.source`),
    license: license(o.license, `${path}.license`),
    ...(o.overrides === undefined
      ? {}
      : { overrides: strArray(o.overrides, `${path}.overrides`) }),
  };
}

function assertUniqueRecordKeys(records: readonly RulesRecord[]): void {
  const seen = new Set<string>();
  for (const item of records) {
    if (seen.has(item.key)) {
      throw new RulesPackError(`records has duplicate key: ${item.key}`);
    }
    seen.add(item.key);
  }
}

export function validateRulesPack(value: unknown): RulesPack {
  const o = obj(value, 'rulesPack');
  const pack: RulesPack = {
    meta: meta(o.meta),
    records: arr(o.records, 'records').map(record),
  };

  assertUniqueRecordKeys(pack.records);

  return pack;
}
