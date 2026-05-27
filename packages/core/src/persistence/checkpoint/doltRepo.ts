import { DoltCli, sqlLiteral } from './doltCli.js';
import type { SnapshotRecord } from './serialize.js';

export interface Checkpoint {
  id: string;
  message: string;
}

export class DoltRepo {
  private readonly cli: DoltCli;

  /**
   * Accept either a directory path (normal use) or a `DoltCli` instance
   * directly — the `DoltCli` form is a test seam.
   */
  constructor(dirOrCli: string | DoltCli) {
    this.cli = typeof dirOrCli === 'string' ? new DoltCli(dirOrCli) : dirOrCli;
  }

  static available(): boolean {
    return DoltCli.available();
  }

  init(): void {
    this.cli.init();
  }

  applySnapshot(records: SnapshotRecord[]): void {
    const lines: string[] = [
      'DROP TABLE IF EXISTS campaign_snapshot;',
      'CREATE TABLE campaign_snapshot (' +
        'tbl VARCHAR(255), kind VARCHAR(16), ordinal INT, payload LONGTEXT, ' +
        'PRIMARY KEY (tbl, kind, ordinal));',
    ];
    for (const r of records) {
      lines.push(
        `INSERT INTO campaign_snapshot (tbl, kind, ordinal, payload) VALUES (${sqlLiteral(r.table)}, ${sqlLiteral(r.kind)}, ${r.ordinal}, ${sqlLiteral(r.payload)});`,
      );
    }
    this.cli.run(['sql'], lines.join('\n'));
  }

  commit(message: string): string {
    return this.cli.commit(message);
  }

  log(): Checkpoint[] {
    // dolt_log is newest-first; full commit_hash, clean message. The message
    // is HEX-encoded in SQL and decoded here: dolt's `-r json` writer does not
    // escape control characters in string values, so a multi-line commit
    // message would otherwise emit a raw newline and break JSON.parse.
    return this.cli
      .query<{ commit_hash: string; message: string }>(
        'SELECT commit_hash, HEX(message) AS message FROM dolt_log',
      )
      .map((r) => ({
        id: r.commit_hash,
        message: Buffer.from(r.message, 'hex').toString('utf8'),
      }));
  }

  readSnapshotAt(id: string): SnapshotRecord[] {
    // payload holds free text — multi-line CREATE statements and serialized
    // row JSON. dolt's `-r json` writer does not escape control characters in
    // string values, so a literal newline in payload produces invalid JSON.
    // HEX-encode payload in SQL and decode it here: hex output is plain ASCII
    // and always parseable. (tbl/kind/ordinal are identifiers and integers and
    // need no encoding.)
    const out = this.cli.run([
      'sql',
      '-r',
      'json',
      '-q',
      `SELECT tbl, kind, ordinal, HEX(payload) AS payload FROM campaign_snapshot AS OF '${id.replace(/'/g, "''")}' ORDER BY tbl, kind, ordinal`,
    ]);
    const parsed = JSON.parse(out) as {
      rows: { tbl: string; kind: string; ordinal: number; payload: string }[];
    };
    return parsed.rows.map((r) => ({
      table: r.tbl,
      kind: r.kind === 'schema' ? 'schema' : 'row',
      ordinal: Number(r.ordinal),
      payload: Buffer.from(r.payload, 'hex').toString('utf8'),
    }));
  }

  branch(name: string, fromId: string): void {
    this.cli.branch(name, fromId);
  }
}
