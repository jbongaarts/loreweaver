import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

/**
 * Thrown when no usable `dolt` CLI can be resolved. The message is
 * intentionally actionable: checkpoint/restore/fork are optional, so callers
 * (e.g. `DoltRepo.available()`) catch this and degrade to "skip", never crash
 * the per-turn path.
 */
export class DoltUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DoltUnavailableError';
  }
}

export interface ResolveDoltOptions {
  /** Highest-priority explicit path (e.g. a config field). */
  explicitPath?: string;
  /** Environment map (defaults to process.env). */
  env?: Record<string, string | undefined>;
  /** PATH directories to scan (defaults to splitting env PATH). */
  pathDirs?: string[];
}

const BIN = process.platform === 'win32' ? 'dolt.exe' : 'dolt';

function isFile(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}

/** OS-default Loreweaver-managed dolt cache dir (where the opt-in provisioner installs). */
export function managedDoltDir(
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env.LOREWEAVER_DOLT_HOME?.trim();
  if (override) return override;
  return join(homedir(), '.loreweaver', 'dolt');
}

/**
 * Resolve a usable `dolt` binary path. Precedence:
 *  1. explicit override (opt.explicitPath, then env LOREWEAVER_DOLT_BIN)
 *  2. Loreweaver-managed cache dir (env LOREWEAVER_DOLT_HOME or OS default)
 *  3. a directory on PATH
 *  4. otherwise throw DoltUnavailableError with install guidance
 *
 * Pure + offline: filesystem lookups only, never executes dolt.
 */
export function resolveDoltBinary(opts: ResolveDoltOptions = {}): string {
  const env = opts.env ?? process.env;

  const explicit = opts.explicitPath ?? env.LOREWEAVER_DOLT_BIN?.trim();
  if (explicit) {
    if (isFile(explicit)) return explicit;
    throw new DoltUnavailableError(
      `LOREWEAVER_DOLT_BIN / explicit dolt path is set to "${explicit}" but no file exists there.`,
    );
  }

  const cached = join(managedDoltDir(env), BIN);
  if (isFile(cached)) return cached;

  const pathDirs = opts.pathDirs ?? (env.PATH ? env.PATH.split(delimiter) : []);
  for (const dir of pathDirs) {
    if (!dir) continue;
    const candidate = join(dir, BIN);
    if (isFile(candidate)) return candidate;
  }

  throw new DoltUnavailableError(
    `No "dolt" binary found. Checkpoint/restore/fork need the Dolt CLI. Resolve it by either: set LOREWEAVER_DOLT_BIN=/path/to/${BIN}; install via "brew install dolt" (macOS), "curl -L https://github.com/dolthub/dolt/releases/latest/download/install.sh | sudo bash" (Linux/macOS), or the Windows .msi from github.com/dolthub/dolt/releases; or place it under ${managedDoltDir(env)}.`,
  );
}
