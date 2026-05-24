import { describe, expect, it } from 'vitest';
import {
  RulesPackError,
  assertShippableRulesPack,
  evaluateRulesPackPolicy,
  validateRulesPack,
} from '../src/internal.js';
import type { RulesPack, RulesPackLicense, RulesRecord } from '../src/internal.js';

function license(
  overrides: Partial<RulesPackLicense> = {},
): RulesPackLicense {
  return {
    licenseClass: 'open',
    licenseName: 'Creative Commons Attribution 4.0 International',
    attributionText: 'Rules text derived from an open SRD fixture.',
    requiresAttribution: true,
    commercialUseAllowed: true,
    hostedUseAllowed: true,
    redistributionAllowed: true,
    publicSharingAllowed: true,
    derivativeAllowed: true,
    containsUserSuppliedText: false,
    containsTrademarkedSettingMaterial: false,
    sourceMaterialDescription: 'Open fantasy rules reference.',
    provenancePolicy: 'Every record includes source and license metadata.',
    outputRestrictions: 'Preserve attribution on redistributed records.',
    ...overrides,
  };
}

function record(key: string, overrides: Partial<RulesRecord> = {}): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'creature',
    key,
    name: 'Goblin',
    data: { hitPoints: 7 },
    source: 'Example SRD p. 1',
    license: license(),
    ...overrides,
  };
}

function validRulesPack(
  overrides: Partial<RulesPack['meta']> & {
    records?: readonly RulesRecord[];
    licenseClass?: RulesPackLicense['licenseClass'];
  } = {},
): RulesPack {
  const { records, licenseClass, ...metaOverrides } = overrides;
  return {
    meta: {
      packId: 'rules:dnd5e-srd',
      title: 'D&D 5e SRD',
      description: 'Provider-neutral rules fixture.',
      role: 'base',
      systemId: 'dnd5e-srd',
      version: '5.1',
      license: license(
        licenseClass === undefined ? {} : { licenseClass },
      ),
      ...metaOverrides,
    },
    records: records ?? [record('creature:goblin')],
  };
}

describe('rules pack validation', () => {
  it('validates a base D&D rules pack with license metadata', () => {
    const pack = validateRulesPack(
      validRulesPack({ role: 'base', systemId: 'dnd5e-srd' }),
    );
    expect(pack.meta.systemId).toBe('dnd5e-srd');
    expect(pack.meta.license.licenseName).toContain('Creative Commons');
  });

  it('rejects blank system ids', () => {
    const pack = validRulesPack({ systemId: '' });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/systemId/);
  });

  it('rejects addon packs without base compatibility metadata', () => {
    const pack = validRulesPack({ role: 'addon' });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/compatibleBaseSystems/);
  });

  it('rejects duplicate record keys in one pack', () => {
    const pack = validRulesPack({
      records: [record('creature:goblin'), record('creature:goblin')],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/duplicate key/);
  });

  it('rejects records missing required data payloads', () => {
    const { data: _data, ...recordWithoutData } = record('creature:goblin');
    const pack = {
      ...validRulesPack(),
      records: [recordWithoutData],
    };

    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/records\[0\]\.data/);
  });

  it('preserves explicit license fields on metadata and records', () => {
    const pack = validateRulesPack(
      validRulesPack({
        license: license({
          licenseName: 'Open RPG Creative License',
          attributionText: 'ORC attribution text.',
          requiresAttribution: false,
        }),
        records: [
          record('creature:goblin', {
            license: license({
              licenseName: 'Creative Commons Zero',
              attributionText: 'No attribution required.',
              requiresAttribution: false,
            }),
          }),
        ],
      }),
    );

    expect(pack.meta.license.licenseName).toBe('Open RPG Creative License');
    expect(pack.meta.license.requiresAttribution).toBe(false);
    expect(pack.records[0].license.licenseName).toBe('Creative Commons Zero');
    expect(pack.records[0].license.attributionText).toBe(
      'No attribution required.',
    );
  });

  it('rejects user-private packs at shippable boundaries', () => {
    const pack = validateRulesPack(
      validRulesPack({ licenseClass: 'user-private' }),
    );
    const policy = evaluateRulesPackPolicy(pack.meta.license);
    expect(policy.shippable).toBe(false);
    expect(policy.reasons.join(' ')).toContain('user-private');
    expect(() => assertShippableRulesPack(pack.meta.license)).toThrow(
      RulesPackError,
    );
  });
});
