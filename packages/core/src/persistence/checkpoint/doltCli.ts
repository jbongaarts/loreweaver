import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { managedDoltRoot, resolveDoltBinary } from './doltBinary.js';

/**
 * Thrown when the Eshyra-managed `config_global.json` exists but is not a
 * JSON object. We refuse to overwrite it (it could hold unrelated data) and
 * surface the problem instead of silently clobbering or proceeding with
 * telemetry left enabled.
 */
export class DoltConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DoltConfigError';
  }
}

/**
 * Per-process guard so the isolated dolt home is configured at most once per
 * root path — avoids redundant fs work on every dolt invocation. A root is
 * only marked prepared after a successful (or best-effort-swallowed) write, so
 * a {@link DoltConfigError} keeps re-surfacing until the bad file is fixed.
 */
const preparedRoots = new Set<string>();

/**
 * Ensure the Eshyra-owned dolt home exists with telemetry disabled.
 *
 * Writes `<root>/.dolt/config_global.json` so it always contains
 * `"metrics.disabled": "true"`, which stops dolt queuing usage events (the
 * unbounded `eventsData` backlog and its network flush are the suspected cause
 * of the transient Windows `init` crash — see loreweaver-cjs). Existing keys in
 * the isolated config are preserved; the invariant is enforced on every call,
 * not just first creation. Because this writes to the ISOLATED root, not the
 * user's `~/.dolt`, it does not violate the "never mutate the user's global
 * dolt config" invariant in {@link DoltCli.init}.
 *
 * Failure handling: invalid existing JSON FAILS FAST ({@link DoltConfigError})
 * rather than silently overwriting unrelated data; ordinary fs failures (e.g. a
 * read-only home) are swallowed so a dolt call is never broken by setup.
 *
 * Exported for unit tests; not part of the stable public surface.
 */
export function ensureDoltRoot(root: string): void {
  if (preparedRoots.has(root)) return;
  const cfgDir = join(root, '.dolt');
  const cfg = join(cfgDir, 'config_global.json');
  try {
    const config = readManagedDoltConfig(cfg);
    config['metrics.disabled'] = 'true';
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(cfg, `${JSON.stringify(config)}\n`);
  } catch (err) {
    // Corrupt managed config must surface; everything else stays best-effort.
    if (err instanceof DoltConfigError) throw err;
    /* swallow: dolt still runs (just possibly with telemetry) if setup fails */
  }
  preparedRoots.add(root);
}

/**
 * Read the managed `config_global.json` as a JSON object. Missing or empty →
 * `{}`. Present-but-not-a-JSON-object → {@link DoltConfigError} (fail fast).
 */
function readManagedDoltConfig(cfg: string): Record<string, unknown> {
  if (!existsSync(cfg)) return {};
  const text = readFileSync(cfg, 'utf8').trim();
  if (text.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new DoltConfigError(
      `Eshyra-managed dolt config at ${cfg} is not valid JSON; refusing to ` +
        `overwrite it. Inspect or remove the file. (${(err as Error).message})`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new DoltConfigError(
      `Eshyra-managed dolt config at ${cfg} is not a JSON object; refusing ` +
        'to overwrite it. Inspect or remove the file.',
    );
  }
  return parsed as Record<string, unknown>;
}

/**
 * Environment for every dolt invocation. Isolates dolt's global home
 * (`DOLT_ROOT_PATH`) to a Eshyra-owned dir, disables event flush as
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
        ['init', '--name', 'eshyra', '--email', 'eshyra@local'],
        { cwd: this.dir, stdio: 'ignore', env: doltEnv() },
      );
    }
    this.run(['config', '--local', '--add', 'user.name', 'eshyra']);
    this.run(['config', '--local', '--add', 'user.email', 'eshyra@local']);
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
