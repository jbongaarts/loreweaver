/**
 * Generic audit and diff tooling for generated rules packs.
 *
 * `auditPack` and `diffPacks` are pure functions over the in-memory
 * `RulesPack` shape produced by `loadRulesPackFromDirectory`. Both run after
 * `validateRulesPack` has already enforced structural and per-kind schema
 * invariants, so the checks here are post-validation heuristics aimed at the
 * questions a reviewer or CI run actually asks:
 *
 *   - `auditPack`: which records look like the parser produced garbage
 *     (empty narrative fields, suspicious names) and which optional `data`
 *     fields are partially populated within a kind (a classic parser-drift
 *     signal). Counts by kind are reported as a sanity baseline.
 *   - `diffPacks`: what changed between two pack outputs — manifest deltas,
 *     records added/removed, and per-field deltas on changed records.
 *
 * Both functions are deliberately generic over `RulesPack`. They contain no
 * SRD-specific or Pathfinder-specific knowledge; per-system coverage checks
 * (e.g. "every SRD 5.1 monster is present") live in importer-adjacent code
 * (loreweaver-0m9.6 / 0m9.9), not here.
 */

import type { RulesPack, RulesPackMeta, RulesRecord } from './types.js';

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface SuspiciousRecord {
  readonly key: string;
  readonly kind: string;
  readonly name: string;
  /** Human-readable reasons; one entry per heuristic the record tripped. */
  readonly reasons: readonly string[];
}

/**
 * One row of the missing-optional-field summary: within `kind`, the data field
 * at `field` is present on some records but missing on `affectedKeys`. A field
 * that is missing on every record of a kind (or present on every record) is
 * not reported — only partial coverage is a parser-drift signal.
 */
export interface MissingFieldGroup {
  readonly kind: string;
  readonly field: string;
  readonly totalInKind: number;
  readonly missingCount: number;
  readonly affectedKeys: readonly string[];
}

export interface PackAudit {
  readonly packId: string;
  readonly recordCount: number;
  /** Record counts keyed by `kind`, sorted by kind. */
  readonly countsByKind: Readonly<Record<string, number>>;
  readonly suspiciousRecords: readonly SuspiciousRecord[];
  readonly missingFieldSummary: readonly MissingFieldGroup[];
}

/**
 * Run the generic audit over a loaded pack. Output ordering is stable so the
 * report is diffable across runs.
 */
export function auditPack(pack: RulesPack): PackAudit {
  const countsByKind = countByKind(pack.records);
  const suspiciousRecords = pack.records
    .map((record) => checkRecordHeuristics(record))
    .filter((entry): entry is SuspiciousRecord => entry !== null)
    .sort(byKey);
  const missingFieldSummary = summarizeMissingFields(pack.records);
  return {
    packId: pack.meta.packId,
    recordCount: pack.records.length,
    countsByKind,
    suspiciousRecords,
    missingFieldSummary,
  };
}

function countByKind(
  records: readonly RulesRecord[],
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const record of records) {
    counts[record.kind] = (counts[record.kind] ?? 0) + 1;
  }
  const sortedKeys = Object.keys(counts).sort();
  const ordered: Record<string, number> = {};
  for (const key of sortedKeys) {
    ordered[key] = counts[key];
  }
  return ordered;
}

function byKey(a: { key: string }, b: { key: string }): number {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * Heuristics for "this record looks like the parser produced garbage." Each
 * check is conservative — none are correctness errors (those throw during
 * validation); they are review prompts.
 */
function checkRecordHeuristics(record: RulesRecord): SuspiciousRecord | null {
  const reasons: string[] = [];
  const trimmedName = record.name.trim();
  if (trimmedName.length < 2) {
    reasons.push('name is shorter than 2 characters');
  }
  if (
    trimmedName.length >= 4 &&
    trimmedName === trimmedName.toUpperCase() &&
    /[A-Z]/.test(trimmedName)
  ) {
    reasons.push(
      'name is all-uppercase (looks like a section heading, not a record)',
    );
  }
  const data = record.data;
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const dataObj = data as Record<string, unknown>;
    if (Object.keys(dataObj).length === 0) {
      reasons.push('data is an empty object');
    }
    for (const [field, value] of Object.entries(dataObj)) {
      if (typeof value === 'string' && value.trim().length === 0) {
        reasons.push(`data.${field} is an empty string`);
      }
    }
  }
  if (reasons.length === 0) return null;
  return {
    key: record.key,
    kind: record.kind,
    name: record.name,
    reasons,
  };
}

/**
 * Build the missing-optional-field summary. For each kind, take the union of
 * keys observed at the top level of each record's `data`. A field is reported
 * only when 0 < missingCount < totalInKind for the kind — uniform absence and
 * uniform presence are both expected.
 */
function summarizeMissingFields(
  records: readonly RulesRecord[],
): readonly MissingFieldGroup[] {
  const byKind = new Map<string, RulesRecord[]>();
  for (const record of records) {
    const bucket = byKind.get(record.kind);
    if (bucket === undefined) {
      byKind.set(record.kind, [record]);
    } else {
      bucket.push(record);
    }
  }

  const out: MissingFieldGroup[] = [];
  for (const kind of [...byKind.keys()].sort()) {
    const kindRecords = byKind.get(kind) ?? [];
    const totalInKind = kindRecords.length;
    const fieldUnion = new Set<string>();
    for (const record of kindRecords) {
      const data = record.data;
      if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        continue;
      }
      for (const field of Object.keys(data as Record<string, unknown>)) {
        fieldUnion.add(field);
      }
    }
    for (const field of [...fieldUnion].sort()) {
      const missing: string[] = [];
      for (const record of kindRecords) {
        const data = record.data;
        const present =
          data !== null &&
          typeof data === 'object' &&
          !Array.isArray(data) &&
          field in (data as Record<string, unknown>);
        if (!present) missing.push(record.key);
      }
      if (missing.length === 0 || missing.length === totalInKind) continue;
      out.push({
        kind,
        field,
        totalInKind,
        missingCount: missing.length,
        affectedKeys: missing,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export interface FieldDelta {
  /** Dotted path from the record root, e.g. `data.armorClass`. */
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
}

export interface RecordDelta {
  readonly key: string;
  readonly kind: string;
  readonly name: string;
}

export interface ChangedRecord extends RecordDelta {
  readonly fieldDeltas: readonly FieldDelta[];
}

export interface PackDiff {
  readonly packIdBefore: string;
  readonly packIdAfter: string;
  readonly metaDeltas: readonly FieldDelta[];
  readonly recordsAdded: readonly RecordDelta[];
  readonly recordsRemoved: readonly RecordDelta[];
  readonly recordsChanged: readonly ChangedRecord[];
}

/**
 * Compare two loaded packs. Output is sorted by record key so the diff is
 * stable and review-friendly. Field deltas walk into nested objects and
 * arrays; primitives and arrays are compared by value, objects are compared
 * key-by-key.
 */
export function diffPacks(before: RulesPack, after: RulesPack): PackDiff {
  const metaDeltas = diffMeta(before.meta, after.meta);
  const beforeByKey = indexByKey(before.records);
  const afterByKey = indexByKey(after.records);

  const recordsAdded: RecordDelta[] = [];
  const recordsRemoved: RecordDelta[] = [];
  const recordsChanged: ChangedRecord[] = [];

  for (const [key, record] of afterByKey) {
    if (!beforeByKey.has(key)) {
      recordsAdded.push({
        key,
        kind: record.kind,
        name: record.name,
      });
    }
  }
  for (const [key, record] of beforeByKey) {
    if (!afterByKey.has(key)) {
      recordsRemoved.push({
        key,
        kind: record.kind,
        name: record.name,
      });
    }
  }
  for (const [key, beforeRecord] of beforeByKey) {
    const afterRecord = afterByKey.get(key);
    if (afterRecord === undefined) continue;
    const fieldDeltas = diffRecord(beforeRecord, afterRecord);
    if (fieldDeltas.length === 0) continue;
    recordsChanged.push({
      key,
      kind: afterRecord.kind,
      name: afterRecord.name,
      fieldDeltas,
    });
  }

  recordsAdded.sort(byKey);
  recordsRemoved.sort(byKey);
  recordsChanged.sort(byKey);

  return {
    packIdBefore: before.meta.packId,
    packIdAfter: after.meta.packId,
    metaDeltas,
    recordsAdded,
    recordsRemoved,
    recordsChanged,
  };
}

function indexByKey(
  records: readonly RulesRecord[],
): ReadonlyMap<string, RulesRecord> {
  const map = new Map<string, RulesRecord>();
  for (const record of records) {
    map.set(record.key, record);
  }
  return map;
}

function diffMeta(
  before: RulesPackMeta,
  after: RulesPackMeta,
): readonly FieldDelta[] {
  return diffValues('meta', before, after);
}

function diffRecord(
  before: RulesRecord,
  after: RulesRecord,
): readonly FieldDelta[] {
  return diffValues('', before, after);
}

/**
 * Deep-diff two values into a flat `FieldDelta[]`. Objects are compared
 * key-by-key (union of keys, so missing keys produce deltas with `undefined`
 * on one side). Arrays are compared by value as a unit — array reordering or
 * any element change produces a single delta on the array path rather than
 * positional deltas. This keeps diffs against sorted-record lists readable.
 */
function diffValues(
  path: string,
  before: unknown,
  after: unknown,
): FieldDelta[] {
  if (areEqual(before, after)) return [];
  if (
    isPlainObject(before) &&
    isPlainObject(after) &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const deltas: FieldDelta[] = [];
    const keys = new Set<string>([
      ...Object.keys(before as Record<string, unknown>),
      ...Object.keys(after as Record<string, unknown>),
    ]);
    for (const key of [...keys].sort()) {
      const childPath = path === '' ? key : `${path}.${key}`;
      const childBefore = (before as Record<string, unknown>)[key];
      const childAfter = (after as Record<string, unknown>)[key];
      deltas.push(...diffValues(childPath, childBefore, childAfter));
    }
    return deltas;
  }
  return [{ path, before, after }];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function areEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!areEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const aKeys = Object.keys(ao);
    const bKeys = Object.keys(bo);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!areEqual(ao[key], bo[key])) return false;
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

/**
 * Human-readable rendering of a `PackAudit`. Use `JSON.stringify(audit, null, 2)`
 * for the machine-readable form.
 */
export function formatAuditReport(audit: PackAudit): string {
  const lines: string[] = [];
  lines.push(`Audit for pack: ${audit.packId}`);
  lines.push(`Total records: ${audit.recordCount}`);
  lines.push('');
  lines.push('Counts by kind:');
  const kinds = Object.keys(audit.countsByKind);
  if (kinds.length === 0) {
    lines.push('  (no records)');
  } else {
    for (const kind of kinds) {
      lines.push(`  ${kind}: ${audit.countsByKind[kind]}`);
    }
  }
  lines.push('');
  lines.push(`Suspicious records: ${audit.suspiciousRecords.length}`);
  for (const entry of audit.suspiciousRecords) {
    lines.push(`  ${entry.key} (${entry.kind}) — ${entry.name}`);
    for (const reason of entry.reasons) {
      lines.push(`    - ${reason}`);
    }
  }
  lines.push('');
  lines.push(
    `Partially-populated data fields: ${audit.missingFieldSummary.length}`,
  );
  for (const group of audit.missingFieldSummary) {
    lines.push(
      `  ${group.kind}.data.${group.field}: missing on ${group.missingCount}/${group.totalInKind} records`,
    );
    for (const key of group.affectedKeys) {
      lines.push(`    - ${key}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Human-readable rendering of a `PackDiff`. Use `JSON.stringify(diff, null, 2)`
 * for the machine-readable form.
 */
export function formatDiffReport(diff: PackDiff): string {
  const lines: string[] = [];
  lines.push(`Diff: ${diff.packIdBefore} → ${diff.packIdAfter}`);
  lines.push('');
  lines.push(`Manifest changes: ${diff.metaDeltas.length}`);
  for (const delta of diff.metaDeltas) {
    lines.push(
      `  ${delta.path}: ${renderValue(delta.before)} → ${renderValue(delta.after)}`,
    );
  }
  lines.push('');
  lines.push(`Records added: ${diff.recordsAdded.length}`);
  for (const entry of diff.recordsAdded) {
    lines.push(`  + ${entry.key} (${entry.kind}) — ${entry.name}`);
  }
  lines.push('');
  lines.push(`Records removed: ${diff.recordsRemoved.length}`);
  for (const entry of diff.recordsRemoved) {
    lines.push(`  - ${entry.key} (${entry.kind}) — ${entry.name}`);
  }
  lines.push('');
  lines.push(`Records changed: ${diff.recordsChanged.length}`);
  for (const entry of diff.recordsChanged) {
    lines.push(`  ~ ${entry.key} (${entry.kind}) — ${entry.name}`);
    for (const delta of entry.fieldDeltas) {
      lines.push(
        `      ${delta.path}: ${renderValue(delta.before)} → ${renderValue(delta.after)}`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

function renderValue(value: unknown): string {
  if (value === undefined) return '<missing>';
  return JSON.stringify(value);
}

/**
 * Returns true when an audit's findings should be treated as failures for the
 * purposes of a `--strict` CI run. Today: any suspicious record OR any
 * partially-populated data field. Counts by kind alone are never a failure.
 */
export function auditHasFindings(audit: PackAudit): boolean {
  return (
    audit.suspiciousRecords.length > 0 || audit.missingFieldSummary.length > 0
  );
}

/**
 * Returns true when a diff has any change — manifest, added, removed, or
 * changed records. Useful for `--strict` CI gating against a baseline pack.
 */
export function diffHasChanges(diff: PackDiff): boolean {
  return (
    diff.metaDeltas.length > 0 ||
    diff.recordsAdded.length > 0 ||
    diff.recordsRemoved.length > 0 ||
    diff.recordsChanged.length > 0
  );
}
