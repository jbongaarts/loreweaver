import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolveDoltBinary } from './doltBinary.js';

/**
 * Encode `s` as a dolt/MySQL string literal (single-quoted).
 *
 * dolt/MySQL string literals process backslash escapes, so a literal
 * backslash in the value — every JSON escape (`\n`, `\"`, `\\`, ...) carries
 * one — must itself be escaped or the stored value is silently corrupted
 * (e.g. `\n` collapses to a real newline). Escape backslashes first, then
 * double single quotes.
 */
export function sqlLiteral(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

/** Low-level dolt CLI wrapper: command execution, SQL queries, repo init, commits, branches. */
export class DoltCli {
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

  run(args: string[], input?: string): string {
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
  query<T>(sql: string): T[] {
    const out = this.run(['sql', '-r', 'json', '-q', sql]);
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

  /**
   * Stage all changes, create a commit, and return the full HEAD hash.
   *
   * Full HEAD hash via SQL — `log --oneline` wraps it in ANSI escapes and
   * an abbreviated form `AS OF` later rejects.
   */
  commit(message: string): string {
    this.run(['add', '-A']);
    this.run(['commit', '--allow-empty', '-m', message]);
    const rows = this.query<{ h: string }>("SELECT HASHOF('HEAD') AS h");
    return rows[0]?.h ?? '';
  }

  branch(name: string, from: string): void {
    this.run(['branch', name, from]);
  }
}
