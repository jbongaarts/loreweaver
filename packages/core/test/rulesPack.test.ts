import { describe, expect, it } from 'vitest';
import type {
  RecordProvenance,
  RulesPack,
  RulesPackLicense,
  RulesPackSource,
  RulesRecord,
} from '../src/internal.js';
import {
  assertShippableRulesPack,
  evaluateRulesPackPolicy,
  RulesPackError,
  validateRulesPack,
} from '../src/internal.js';

const DEFAULT_SOURCE_URL = 'https://example.test/srd/5.1';

function packSource(overrides: Partial<RulesPackSource> = {}): RulesPackSource {
  return {
    sourceTitle: 'Example SRD',
    sourceVersion: '5.1',
    sourceUrl: DEFAULT_SOURCE_URL,
    recordProvenancePolicy:
      'Every record cites the SRD page it was extracted from.',
    ...overrides,
  };
}

function recordProvenance(
  overrides: Partial<RecordProvenance> = {},
): RecordProvenance {
  return {
    sourceRef: DEFAULT_SOURCE_URL,
    locator: 'p. 1',
    ...overrides,
  };
}

function license(overrides: Partial<RulesPackLicense> = {}): RulesPackLicense {
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

function creatureData(): Record<string, unknown> {
  return {
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
  };
}

function record(
  key: string,
  overrides: Partial<RulesRecord> = {},
): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'creature',
    key,
    name: 'Goblin',
    data: creatureData(),
    source: 'Example SRD p. 1',
    license: license(),
    provenance: recordProvenance(),
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
      license: license(licenseClass === undefined ? {} : { licenseClass }),
      source: packSource(),
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

  it('preserves source manifest fields on meta', () => {
    const sourceUrl = 'https://example.test/srd/5.2';
    const pack = validateRulesPack(
      validRulesPack({
        source: packSource({
          sourceHash: 'sha256:deadbeef',
          sourceDate: '2024-01-15',
          sourceUrl,
        }),
        records: [
          record('creature:goblin', {
            provenance: recordProvenance({ sourceRef: sourceUrl }),
          }),
        ],
      }),
    );
    expect(pack.meta.source.sourceTitle).toBe('Example SRD');
    expect(pack.meta.source.sourceHash).toBe('sha256:deadbeef');
    expect(pack.meta.source.sourceDate).toBe('2024-01-15');
    expect(pack.meta.source.sourceUrl).toBe(sourceUrl);
  });

  it('rejects packs whose source has neither sourceUrl nor sourceIdentity', () => {
    const sourceWithNeither = {
      sourceTitle: 'Example SRD',
      sourceVersion: '5.1',
      recordProvenancePolicy: 'records cite section',
    };
    const pack = validRulesPack({
      source: sourceWithNeither as RulesPackSource,
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(
      /sourceUrl or sourceIdentity/,
    );
  });

  it('accepts sourceIdentity in place of sourceUrl for vendored corpora', () => {
    const identity = 'pf2e-remaster:vendor:2024-q4';
    const pack = validateRulesPack(
      validRulesPack({
        source: {
          sourceTitle: 'Pathfinder 2e Remaster (vendored)',
          sourceVersion: '1.0',
          sourceIdentity: identity,
          recordProvenancePolicy:
            'records cite Player/GM/Monster Core section.',
        },
        records: [
          record('creature:goblin', {
            provenance: recordProvenance({ sourceRef: identity }),
          }),
        ],
      }),
    );
    expect(pack.meta.source.sourceIdentity).toBe(identity);
    expect(pack.records[0].provenance.sourceRef).toBe(identity);
  });

  it('rejects records whose provenance does not match the pack source', () => {
    const pack = validRulesPack({
      records: [
        record('creature:goblin', {
          provenance: recordProvenance({
            sourceRef: 'https://example.test/other',
          }),
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(
      /provenance\.sourceRef must match/,
    );
  });

  it('rejects records missing provenance', () => {
    const { provenance: _p, ...recordWithoutProvenance } =
      record('creature:goblin');
    const pack = {
      ...validRulesPack(),
      records: [recordWithoutProvenance],
    };
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/records\[0\]\.provenance/);
  });

  it('rejects packs missing meta.source entirely', () => {
    const validMeta = validRulesPack().meta;
    const { source: _s, ...metaWithoutSource } = validMeta;
    const pack = {
      ...validRulesPack(),
      meta: metaWithoutSource as RulesPack['meta'],
    };
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/meta\.source/);
  });

  it('rejects dnd5e creature records missing required schema fields', () => {
    const pack = validRulesPack({
      records: [record('creature:goblin', { data: { hitPoints: 7 } })],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/data\.size/);
  });

  it('rejects dnd5e creature records with malformed ability scores', () => {
    const data = creatureData();
    const abilityScores = {
      ...(data.abilityScores as Record<string, number>),
      strength: -1,
    };
    const pack = validRulesPack({
      records: [
        record('creature:goblin', {
          data: { ...data, abilityScores },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/abilityScores\.strength/);
  });

  it('rejects dnd5e spell records missing the level field', () => {
    const pack = validRulesPack({
      records: [
        record('spell:fire-bolt', {
          kind: 'spell',
          name: 'Fire Bolt',
          data: {
            school: 'evocation',
            castingTime: '1 action',
            range: '120 feet',
            components: ['V', 'S'],
            duration: 'Instantaneous',
            classes: ['Sorcerer', 'Wizard'],
          },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/data\.level/);
  });

  it('accepts dnd5e spell records that match the spell schema', () => {
    const pack = validateRulesPack(
      validRulesPack({
        records: [
          record('spell:fire-bolt', {
            kind: 'spell',
            name: 'Fire Bolt',
            data: {
              level: 0,
              school: 'evocation',
              castingTime: '1 action',
              range: '120 feet',
              components: ['V', 'S'],
              duration: 'Instantaneous',
              classes: ['Sorcerer', 'Wizard'],
            },
          }),
        ],
      }),
    );
    expect(pack.records[0].kind).toBe('spell');
  });

  it('rejects dnd5e action records missing a description', () => {
    const pack = validRulesPack({
      records: [
        record('action:attack', {
          kind: 'action',
          name: 'Attack',
          data: {},
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/data\.description/);
  });

  it('accepts dnd5e feature records linked to a grantor and level', () => {
    const pack = validateRulesPack(
      validRulesPack({
        records: [
          record('feature:action-surge', {
            kind: 'feature',
            name: 'Action Surge',
            data: {
              description:
                'You can push yourself beyond your normal limits for a moment.',
              source: 'class:fighter',
              level: 2,
            },
          }),
        ],
      }),
    );
    expect(pack.records[0].kind).toBe('feature');
  });

  it('rejects dnd5e feature records missing the grantor source link', () => {
    const pack = validRulesPack({
      records: [
        record('feature:rage', {
          kind: 'feature',
          name: 'Rage',
          data: { description: 'In battle, you fight with primal ferocity.' },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/data\.source/);
  });

  it('rejects dnd5e feature records without the level gained', () => {
    const pack = validRulesPack({
      records: [
        record('feature:channel-divinity', {
          kind: 'feature',
          name: 'Channel Divinity',
          data: {
            description: 'You can channel divine energy directly from a deity.',
            source: 'class:cleric',
          },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/data\.level/);
  });

  it('accepts dnd5e subclass records linked to a parent class', () => {
    const pack = validateRulesPack(
      validRulesPack({
        records: [
          record('subclass:champion', {
            kind: 'subclass',
            name: 'Champion',
            data: {
              parentClass: 'class:fighter',
              description:
                'The archetypal Champion focuses on the development of raw physical power.',
              features: ['feature:improved-critical'],
            },
          }),
        ],
      }),
    );
    expect(pack.records[0].kind).toBe('subclass');
  });

  it('rejects dnd5e subclass records missing the parent class link', () => {
    const pack = validRulesPack({
      records: [
        record('subclass:life-domain', {
          kind: 'subclass',
          name: 'Life Domain',
          data: {
            description:
              'The Life domain focuses on the vibrant positive energy.',
          },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/data\.parentClass/);
  });

  it('does not require base-class scalar fields on a subclass', () => {
    // A subclass carries only its own fields; hitDie/proficiencies stay on
    // the parent `class` record (ADR 0009). Description is still required.
    const pack = validRulesPack({
      records: [
        record('subclass:evocation', {
          kind: 'subclass',
          name: 'School of Evocation',
          data: { parentClass: 'class:wizard' },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/data\.description/);
  });

  it('rejects rule records without a text body', () => {
    const pack = validRulesPack({
      records: [
        record('rule:cover', {
          kind: 'rule',
          name: 'Cover',
          systemId: 'misc-system',
          data: { description: 'A creature behind cover...' },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/data\.text/);
  });

  it('rejects table records without columns and rows arrays', () => {
    const pack = validRulesPack({
      records: [
        record('table:starting-equipment', {
          kind: 'table',
          name: 'Starting Equipment',
          systemId: 'misc-system',
          data: { columns: ['Class', 'Pack'] },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/data\.rows/);
  });

  it('accepts table records with non-empty columns and scalar rows', () => {
    const pack = validateRulesPack(
      validRulesPack({
        records: [
          record('table:difficulty-classes', {
            kind: 'table',
            name: 'Difficulty Classes',
            systemId: 'misc-system',
            data: {
              columns: ['Task Difficulty', 'DC', 'Applies'],
              rows: [
                ['Easy', 10, true],
                ['Special', null, false],
              ],
            },
          }),
        ],
      }),
    );
    expect(pack.records[0].kind).toBe('table');
  });

  it('rejects table records with empty columns', () => {
    const pack = validRulesPack({
      records: [
        record('table:empty-columns', {
          kind: 'table',
          name: 'Empty Columns',
          systemId: 'misc-system',
          data: { columns: [], rows: [] },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(/data\.columns/);
  });

  it('rejects table rows whose length does not match columns', () => {
    const pack = validRulesPack({
      records: [
        record('table:difficulty-classes', {
          kind: 'table',
          name: 'Difficulty Classes',
          systemId: 'misc-system',
          data: {
            columns: ['Task Difficulty', 'DC'],
            rows: [['Easy'], ['Hard', 20, 'extra']],
          },
        }),
      ],
    });
    expect(() => validateRulesPack(pack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(pack)).toThrow(
      /data\.rows\[0\] length must match data\.columns length/,
    );
  });

  it('rejects table row cells that are objects or arrays', () => {
    const objectCellPack = validRulesPack({
      records: [
        record('table:object-cell', {
          kind: 'table',
          name: 'Object Cell',
          systemId: 'misc-system',
          data: {
            columns: ['Name', 'Value'],
            rows: [['Easy', { dc: 10 }]],
          },
        }),
      ],
    });
    expect(() => validateRulesPack(objectCellPack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(objectCellPack)).toThrow(
      /data\.rows\[0\]\[1\]/,
    );

    const arrayCellPack = validRulesPack({
      records: [
        record('table:array-cell', {
          kind: 'table',
          name: 'Array Cell',
          systemId: 'misc-system',
          data: {
            columns: ['Name', 'Values'],
            rows: [['Easy', [10]]],
          },
        }),
      ],
    });
    expect(() => validateRulesPack(arrayCellPack)).toThrow(RulesPackError);
    expect(() => validateRulesPack(arrayCellPack)).toThrow(
      /data\.rows\[0\]\[1\]/,
    );
  });

  it('falls through to the baseline data check for unregistered systems', () => {
    const pack = validateRulesPack(
      validRulesPack({
        systemId: 'experimental-system',
        records: [
          record('creature:goblin', {
            systemId: 'experimental-system',
            kind: 'creature',
            data: { description: 'A small green humanoid.' },
          }),
        ],
      }),
    );
    expect(pack.records[0].systemId).toBe('experimental-system');
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
