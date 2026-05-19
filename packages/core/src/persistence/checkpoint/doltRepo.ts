import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolveDoltBinary } from './doltBinary.js';
import type { SnapshotRecord } from './serialize.js';

export interface Checkpoint {
  id: string;
  message: string;
}

function sq(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export class DoltRepo {
  constructor(private readonly dir: string) {}

  /** Resolved lazily so a missing binary never throws at construction time. */
  private bin?: string;

  private binary(): string {
    if (this.bin === undefined) this.bin = resolveDoltBinary();
    return this.bin;
  }

  static available(): boolean {
    try {
      execFileSync(resolveDoltBinary(), ['version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  private run(args: string[], input?: string): string {
    return execFileSync(this.binary(), args, {
      cwd: this.dir,
      input,
      encoding: 'utf8',
      // dolt colorizes `log` with ANSI escapes that corrupt hash parsing;
      // NO_COLOR is honored repo-wide as defense in depth.
      env: { ...process.env, NO_COLOR: '1' },
    });
  }

  /** Run a query and return its JSON rows (clean — no ANSI, machine-stable). */
  private sqlRows<T>(query: string): T[] {
    const out = this.run(['sql', '-r', 'json', '-q', query]);
    const parsed = JSON.parse(out) as { rows?: T[] };
    return parsed.rows ?? [];
  }

  init(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    if (!existsSync(`${this.dir}/.dolt`)) {
      // --name/--email keep identity repo-local: `dolt init` fails with
      // "Author identity unknown" otherwise, and we must NOT mutate the
      // user's global dolt config.
      execFileSync(
        this.binary(),
        ['init', '--name', 'loreweaver', '--email', 'loreweaver@local'],
        { cwd: this.dir, stdio: 'ignore' },
      );
    }
    this.run(['config', '--local', '--add', 'user.name', 'loreweaver']);
    this.run(['config', '--local', '--add', 'user.email', 'loreweaver@local']);
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
        `INSERT INTO campaign_snapshot (tbl, kind, ordinal, payload) VALUES (` +
          `${sq(r.table)}, ${sq(r.kind)}, ${r.ordinal}, ${sq(r.payload)});`,
      );
    }
    this.run(['sql'], lines.join('\n'));
  }

  commit(message: string): string {
    this.run(['add', '-A']);
    this.run(['commit', '--allow-empty', '-m', message]);
    // Full HEAD hash via SQL — `log --oneline` wraps it in ANSI escapes and
    // an abbreviated form `AS OF` later rejects.
    const rows = this.sqlRows<{ h: string }>("SELECT HASHOF('HEAD') AS h");
    return rows[0]?.h ?? '';
  }

  log(): Checkpoint[] {
    // dolt_log is newest-first; full commit_hash, clean message.
    return this.sqlRows<{ commit_hash: string; message: string }>(
      'SELECT commit_hash, message FROM dolt_log',
    ).map((r) => ({ id: r.commit_hash, message: r.message }));
  }

  readSnapshotAt(id: string): SnapshotRecord[] {
    const out = this.run([
      'sql',
      '-r',
      'json',
      '-q',
      `SELECT tbl, kind, ordinal, payload FROM campaign_snapshot ` +
        `AS OF '${id.replace(/'/g, "''")}' ORDER BY tbl, kind, ordinal`,
    ]);
    const parsed = JSON.parse(out) as {
      rows: { tbl: string; kind: string; ordinal: number; payload: string }[];
    };
    return parsed.rows.map((r) => ({
      table: r.tbl,
      kind: r.kind === 'schema' ? 'schema' : 'row',
      ordinal: Number(r.ordinal),
      payload: r.payload,
    }));
  }

  branch(name: string, fromId: string): void {
    this.run(['branch', name, fromId]);
  }
}
