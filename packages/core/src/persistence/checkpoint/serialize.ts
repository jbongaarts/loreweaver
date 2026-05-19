import type { Db } from '../db.js';

export interface SnapshotRecord {
  table: string;
  kind: 'schema' | 'row';
  ordinal: number;
  payload: string;
}

interface MasterRow {
  name: string;
  sql: string | null;
}

export function serializeCampaign(db: Db): SnapshotRecord[] {
  const tables = (
    db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type='table' " +
          "AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as MasterRow[]
  ).filter((t) => t.sql !== null);

  const records: SnapshotRecord[] = [];

  for (const t of tables) {
    records.push({
      table: t.name,
      kind: 'schema',
      ordinal: 0,
      payload: JSON.stringify({ create: t.sql }),
    });
  }
  for (const t of tables) {
    const rows = db.prepare(`SELECT * FROM "${t.name}"`).all() as Record<
      string,
      unknown
    >[];
    const encoded = rows
      .map((r) => canonicalRow(r))
      .sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    encoded.forEach((payload, i) => {
      records.push({ table: t.name, kind: 'row', ordinal: i, payload });
    });
  }
  return records;
}

function canonicalRow(row: Record<string, unknown>): string {
  const keys = Object.keys(row).sort();
  const obj: Record<string, unknown> = {};
  for (const k of keys) {
    const v = row[k];
    obj[k] = Buffer.isBuffer(v) ? { __blob: v.toString('base64') } : v;
  }
  return JSON.stringify(obj);
}

export function canonicalize(records: SnapshotRecord[]): string {
  return records
    .map(
      (r) =>
        `{"table":${JSON.stringify(r.table)},"kind":${JSON.stringify(
          r.kind,
        )},"ordinal":${r.ordinal},"payload":${JSON.stringify(r.payload)}}`,
    )
    .join('\n');
}
