import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
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

  static available(): boolean {
    try {
      execFileSync('dolt', ['version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  private run(args: string[], input?: string): string {
    return execFileSync('dolt', args, {
      cwd: this.dir,
      input,
      encoding: 'utf8',
    });
  }

  init(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    if (!existsSync(`${this.dir}/.dolt`)) {
      execFileSync('dolt', ['init'], { cwd: this.dir, stdio: 'ignore' });
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
    return this.run(['log', '-n', '1', '--oneline']).trim().split(/\s+/)[0] ?? '';
  }

  log(): Checkpoint[] {
    const out = this.run(['log', '--oneline']).trim();
    if (!out) return [];
    return out.split('\n').map((line) => {
      const sp = line.indexOf(' ');
      return sp === -1
        ? { id: line, message: '' }
        : { id: line.slice(0, sp), message: line.slice(sp + 1) };
    });
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
