import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { managedDoltRoot, resolveDoltBinary } from './doltBinary.js';

/**
 * Per-process guard so the isolated dolt home is configured at most once per
 * root path (the file write is idempotent; the Set just avoids redundant fs
 * calls on every dolt invocation).
 */
const preparedRoots = new Set<string>();

/**
 * Ensure the Loreweaver-owned dolt home exists with telemetry disabled.
 *
 * Pre-writes `<root>/.dolt/config_global.json` with `metrics.disabled` so dolt
 * never queues usage events (the unbounded `eventsData` backlog and its
 * network flush are the suspected cause of the transient Windows `init` crash —
 * see loreweaver-cjs). Because this writes to the ISOLATED root, not the user's
 * `~/.dolt`, it does not violate the "never mutate the user's global dolt
 * config" invariant in {@link DoltCli.init}. Best-effort: a failure here must
 * never break a dolt call, so it is swallowed.
 */
function ensureDoltRoot(root: string): void {
  if (preparedRoots.has(root)) return;
  try {
    const cfgDir = join(root, '.dolt');
    mkdirSync(cfgDir, { recursive: true });
    const cfg = join(cfgDir, 'config_global.json');
    if (!existsSync(cfg)) writeFileSync(cfg, '{"metrics.disabled":"true"}\n');
  } catch {
    /* swallow: dolt still runs (just possibly with telemetry) if setup fails */
  }
  // Mark prepared even on failure so we do not retry fs work on every call.
  preparedRoots.add(root);
}

/**
 * Environment for every dolt invocation. Isolates dolt's global home
 * (`DOLT_ROOT_PATH`) to a Loreweaver-owned dir, disables event flush as
 * belt-and-suspenders against any event that slips past `metrics.disabled`, and
 * keeps `NO_COLOR` so ANSI escapes never corrupt hash/JSON parsing.
 */
function doltEnv(): NodeJS.ProcessEnv {
  const root = managedDoltRoot();
  ensureDoltRoot(root);
  return {
    ...process.env,
    NO_COLOR: '1',
    DOLT_ROOT_PATH: root,
    DOLT_DISABLE_EVENT_FLUSH: 'true',
  };
}

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
      execFileSync(resolveDoltBinary(), ['version'], {
        stdio: 'ignore',
        env: doltEnv(),
      });
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
      // doltEnv() supplies NO_COLOR (ANSI escapes corrupt hash/JSON parsing)
      // plus DOLT_ROOT_PATH isolation and telemetry-off.
      env: doltEnv(),
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
        { cwd: this.dir, stdio: 'ignore', env: doltEnv() },
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
