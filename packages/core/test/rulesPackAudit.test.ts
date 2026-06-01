/**
 * Unit tests for the generic rules-pack audit/diff library
 * (`src/rules/audit.ts`). Fixtures mirror the shapes used by `rulesPack.test.ts`
 * so the same baseline pack invariants hold; the audit and diff functions then
 * operate over those validated packs.
 */

import { describe, expect, it } from 'vitest';
import type {
  RecordProvenance,
  RulesPack,
  RulesPackLicense,
  RulesPackSource,
  RulesRecord,
} from '../src/internal.js';
import {
  auditHasFindings,
  auditPack,
  diffHasChanges,
  diffPacks,
  formatAuditReport,
  formatDiffReport,
} from '../src/internal.js';

const SOURCE_URL = 'https://example.test/srd/5.1';

function packSource(overrides: Partial<RulesPackSource> = {}): RulesPackSource {
  return {
    sourceTitle: 'Example SRD',
    sourceVersion: '5.1',
    sourceUrl: SOURCE_URL,
    recordProvenancePolicy:
      'Every record cites the SRD page it was extracted from.',
    ...overrides,
  };
}

function provenance(
  overrides: Partial<RecordProvenance> = {},
): RecordProvenance {
  return { sourceRef: SOURCE_URL, locator: 'p. 1', ...overrides };
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

function record(overrides: Partial<RulesRecord> = {}): RulesRecord {
  return {
    systemId: 'dnd5e-srd',
    kind: 'spell',
    key: 'spell:acid-splash',
    name: 'Acid Splash',
    data: { level: 0, school: 'conjuration', description: 'Hurl acid.' },
    source: 'Example SRD p. 1',
    license: license(),
    provenance: provenance(),
    ...overrides,
  };
}

function pack(records: readonly RulesRecord[]): RulesPack {
  return {
    meta: {
      packId: 'rules:dnd5e-srd-5.1',
      title: 'D&D 5e SRD 5.1',
      description: 'Fixture pack.',
      role: 'base',
      systemId: 'dnd5e-srd',
      version: '5.1',
      license: license(),
      source: packSource(),
    },
    records,
  };
}

// ---------------------------------------------------------------------------
// auditPack
// ---------------------------------------------------------------------------

describe('auditPack', () => {
  it('reports an empty result for a clean pack with no anomalies', () => {
    const audit = auditPack(
      pack([
        record({ key: 'spell:acid-splash', name: 'Acid Splash' }),
        record({
          key: 'creature:goblin',
          kind: 'creature',
          name: 'Goblin',
          data: { description: 'A small humanoid.' },
        }),
      ]),
    );
    expect(audit.packId).toBe('rules:dnd5e-srd-5.1');
    expect(audit.recordCount).toBe(2);
    expect(audit.countsByKind).toEqual({ creature: 1, spell: 1 });
    expect(audit.suspiciousRecords).toEqual([]);
    expect(audit.missingFieldSummary).toEqual([]);
    expect(auditHasFindings(audit)).toBe(false);
  });

  it('flags a record whose name is all-uppercase (section heading leak)', () => {
    const audit = auditPack(
      pack([
        record({ key: 'spell:acid-splash' }),
        record({
          key: 'spell:actions',
          name: 'ACTIONS',
          data: { level: 0, school: 'conjuration', description: 'x' },
        }),
      ]),
    );
    expect(audit.suspiciousRecords).toHaveLength(1);
    const finding = audit.suspiciousRecords[0];
    expect(finding.key).toBe('spell:actions');
    expect(finding.reasons.some((r) => r.includes('all-uppercase'))).toBe(true);
    expect(auditHasFindings(audit)).toBe(true);
  });

  it('flags a record with a single-character name', () => {
    const audit = auditPack(
      pack([record({ key: 'spell:x', name: 'X', data: { level: 0 } })]),
    );
    expect(audit.suspiciousRecords).toHaveLength(1);
    expect(audit.suspiciousRecords[0].reasons).toContain(
      'name is shorter than 2 characters',
    );
  });

  it('flags an empty data object and empty string fields', () => {
    const audit = auditPack(
      pack([
        record({ key: 'spell:empty', name: 'Empty', data: {} }),
        record({
          key: 'spell:blank-desc',
          name: 'Blank Description',
          data: { level: 0, description: '   ' },
        }),
      ]),
    );
    const empty = audit.suspiciousRecords.find((r) => r.key === 'spell:empty');
    expect(empty?.reasons).toContain('data is an empty object');
    const blank = audit.suspiciousRecords.find(
      (r) => r.key === 'spell:blank-desc',
    );
    expect(blank?.reasons.some((r) => r.includes('description'))).toBe(true);
  });

  it('reports a field that is present on some records of a kind but missing on others', () => {
    const audit = auditPack(
      pack([
        record({
          key: 'spell:a',
          name: 'A Spell',
          data: { level: 0, school: 'conjuration', description: 'x' },
        }),
        record({
          key: 'spell:b',
          name: 'B Spell',
          data: { level: 1, description: 'y' },
        }),
        record({
          key: 'spell:c',
          name: 'C Spell',
          data: { level: 1, school: 'evocation', description: 'z' },
        }),
      ]),
    );
    expect(audit.missingFieldSummary).toHaveLength(1);
    const group = audit.missingFieldSummary[0];
    expect(group).toMatchObject({
      kind: 'spell',
      field: 'school',
      totalInKind: 3,
      missingCount: 1,
    });
    expect(group.affectedKeys).toEqual(['spell:b']);
  });

  it('does not report a field that is uniformly present or uniformly absent', () => {
    const audit = auditPack(
      pack([
        record({
          key: 'spell:a',
          data: { level: 0, description: 'x' },
        }),
        record({
          key: 'spell:b',
          name: 'B',
          data: { level: 1, description: 'y' },
        }),
      ]),
    );
    expect(audit.missingFieldSummary).toEqual([]);
  });

  it('renders a stable human-readable report', () => {
    const audit = auditPack(
      pack([record({ key: 'spell:acid-splash', name: 'Acid Splash' })]),
    );
    const text = formatAuditReport(audit);
    expect(text).toContain('Audit for pack: rules:dnd5e-srd-5.1');
    expect(text).toContain('Total records: 1');
    expect(text).toContain('spell: 1');
  });
});

// ---------------------------------------------------------------------------
// diffPacks
// ---------------------------------------------------------------------------

describe('diffPacks', () => {
  it('returns no changes for byte-identical packs', () => {
    const a = pack([record({ key: 'spell:acid-splash' })]);
    const b = pack([record({ key: 'spell:acid-splash' })]);
    const diff = diffPacks(a, b);
    expect(diff.metaDeltas).toEqual([]);
    expect(diff.recordsAdded).toEqual([]);
    expect(diff.recordsRemoved).toEqual([]);
    expect(diff.recordsChanged).toEqual([]);
    expect(diffHasChanges(diff)).toBe(false);
  });

  it('detects an added record', () => {
    const a = pack([record({ key: 'spell:acid-splash' })]);
    const b = pack([
      record({ key: 'spell:acid-splash' }),
      record({ key: 'spell:fire-bolt', name: 'Fire Bolt' }),
    ]);
    const diff = diffPacks(a, b);
    expect(diff.recordsAdded).toEqual([
      { key: 'spell:fire-bolt', kind: 'spell', name: 'Fire Bolt' },
    ]);
    expect(diff.recordsRemoved).toEqual([]);
    expect(diff.recordsChanged).toEqual([]);
    expect(diffHasChanges(diff)).toBe(true);
  });

  it('detects a removed record', () => {
    const a = pack([
      record({ key: 'spell:acid-splash' }),
      record({ key: 'spell:fire-bolt', name: 'Fire Bolt' }),
    ]);
    const b = pack([record({ key: 'spell:acid-splash' })]);
    const diff = diffPacks(a, b);
    expect(diff.recordsRemoved).toEqual([
      { key: 'spell:fire-bolt', kind: 'spell', name: 'Fire Bolt' },
    ]);
  });

  it('detects a per-field change inside data', () => {
    const a = pack([
      record({
        key: 'spell:acid-splash',
        data: { level: 0, description: 'Old text.' },
      }),
    ]);
    const b = pack([
      record({
        key: 'spell:acid-splash',
        data: { level: 0, description: 'New text.' },
      }),
    ]);
    const diff = diffPacks(a, b);
    expect(diff.recordsChanged).toHaveLength(1);
    const changed = diff.recordsChanged[0];
    expect(changed.key).toBe('spell:acid-splash');
    expect(changed.fieldDeltas).toEqual([
      { path: 'data.description', before: 'Old text.', after: 'New text.' },
    ]);
  });

  it('treats arrays as atomic — array reorder is a single field delta', () => {
    const a = pack([
      record({
        key: 'spell:acid-splash',
        data: { components: ['V', 'S'] },
      }),
    ]);
    const b = pack([
      record({
        key: 'spell:acid-splash',
        data: { components: ['S', 'V'] },
      }),
    ]);
    const diff = diffPacks(a, b);
    expect(diff.recordsChanged).toHaveLength(1);
    expect(diff.recordsChanged[0].fieldDeltas).toEqual([
      {
        path: 'data.components',
        before: ['V', 'S'],
        after: ['S', 'V'],
      },
    ]);
  });

  it('detects newly-added and newly-missing optional fields inside data', () => {
    const a = pack([record({ key: 'spell:acid-splash', data: { level: 0 } })]);
    const b = pack([
      record({
        key: 'spell:acid-splash',
        data: { level: 0, ritual: true },
      }),
    ]);
    const diff = diffPacks(a, b);
    expect(diff.recordsChanged[0].fieldDeltas).toEqual([
      { path: 'data.ritual', before: undefined, after: true },
    ]);
  });

  it('reports manifest deltas at dotted meta.* paths', () => {
    const a = pack([record({ key: 'spell:acid-splash' })]);
    const b: RulesPack = {
      ...pack([record({ key: 'spell:acid-splash' })]),
      meta: {
        ...pack([]).meta,
        version: '5.2',
      },
    };
    const diff = diffPacks(a, b);
    expect(diff.metaDeltas).toContainEqual({
      path: 'meta.version',
      before: '5.1',
      after: '5.2',
    });
  });

  it('sorts records added/removed/changed lists by key for stable output', () => {
    const a = pack([
      record({ key: 'spell:a', name: 'A' }),
      record({ key: 'spell:c', name: 'C' }),
    ]);
    const b = pack([
      record({ key: 'spell:c', name: 'C', data: { level: 1 } }),
      record({ key: 'spell:b', name: 'B' }),
    ]);
    const diff = diffPacks(a, b);
    expect(diff.recordsAdded.map((r) => r.key)).toEqual(['spell:b']);
    expect(diff.recordsRemoved.map((r) => r.key)).toEqual(['spell:a']);
    expect(diff.recordsChanged.map((r) => r.key)).toEqual(['spell:c']);
  });

  it('renders a stable human-readable report', () => {
    const a = pack([record({ key: 'spell:acid-splash' })]);
    const b = pack([
      record({ key: 'spell:acid-splash' }),
      record({ key: 'spell:fire-bolt', name: 'Fire Bolt' }),
    ]);
    const diff = diffPacks(a, b);
    const text = formatDiffReport(diff);
    expect(text).toContain('Records added: 1');
    expect(text).toContain('+ spell:fire-bolt');
  });
});
