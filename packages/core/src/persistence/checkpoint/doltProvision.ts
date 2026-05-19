import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DoltUnavailableError,
  managedDoltDir,
  resolveDoltBinary,
  type ResolveDoltOptions,
} from './doltBinary.js';

/**
 * Pinned dolt release. Bumping this REQUIRES recomputing every sha256 below
 * from the official GitHub assets (dolt publishes no checksum sidecar files,
 * so the pin in this file is the only trust anchor — see loreweaver-8kt).
 */
export const DOLT_PINNED_VERSION = 'v2.0.3';

export class DoltUnverifiedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DoltUnverifiedError';
  }
}

interface AssetSpec {
  asset: string;
  /** Real SHA256 of the pinned asset; `UNPINNED` means "refuse to install". */
  sha256: string;
}

/** key = `${process.platform}-${process.arch}` */
const MANIFEST: Record<string, AssetSpec> = {
  'darwin-x64': {
    asset: 'dolt-darwin-amd64.tar.gz',
    sha256: '592e37385313cabe3e96208e4b8edc3e7c05c18c22ee325415c65981320de584',
  },
  'darwin-arm64': {
    asset: 'dolt-darwin-arm64.tar.gz',
    sha256: '0bd13f4e0e06cf3cd7022bd27b926c3b2ea69ae6a1946ab9410c98cdbbc72021',
  },
  'linux-x64': {
    asset: 'dolt-linux-amd64.tar.gz',
    sha256: '82445e0ef6f2366c78f959ffa225d9b47c78dd4dac9e19d4cd83c814b7dd5135',
  },
  'linux-arm64': {
    asset: 'dolt-linux-arm64.tar.gz',
    sha256: '321ac97f0a44af32eff8004cadef841bc683f683101de96dea2deda6ad86f950',
  },
  'win32-x64': {
    asset: 'dolt-windows-amd64.zip',
    sha256: 'd05c5a235281202697ddfd345227f50c6ce8c9954f0938760799c8ea9e649dc0',
  },
};

export interface DoltAsset {
  asset: string;
  sha256: string;
  url: string;
}

export function doltAssetFor(
  platform: NodeJS.Platform,
  arch: string,
  version: string = DOLT_PINNED_VERSION,
): DoltAsset {
  const spec = MANIFEST[`${platform}-${arch}`];
  if (!spec) {
    throw new DoltUnavailableError(
      `No pinned dolt asset for ${platform}/${arch}. Install dolt manually and ` +
        `point LOREWEAVER_DOLT_BIN at it.`,
    );
  }
  return {
    asset: spec.asset,
    sha256: spec.sha256,
    url: `https://github.com/dolthub/dolt/releases/download/${version}/${spec.asset}`,
  };
}

export function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/** Fail-closed: an unpinned or mismatched checksum throws; it is never bypassable. */
export function verifyArchive(filePath: string, expectedSha256: string): void {
  if (!expectedSha256 || expectedSha256 === 'UNPINNED') {
    throw new DoltUnverifiedError(
      'dolt checksum is not pinned for this platform; refusing to install an ' +
        'unverified binary. Install dolt manually and set LOREWEAVER_DOLT_BIN.',
    );
  }
  const actual = sha256File(filePath);
  if (actual !== expectedSha256) {
    throw new DoltUnverifiedError(
      `dolt archive sha256 mismatch: expected ${expectedSha256}, got ${actual}. ` +
        `Refusing to install.`,
    );
  }
}

export interface ProvisionOptions {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  arch?: string;
  version?: string;
  /** Injectable for offline tests; default does an HTTPS GET. */
  download?: (url: string, destFile: string) => void | Promise<void>;
  /** Injectable for offline tests; default shells to `tar -xf`. */
  extract?: (archive: string, destDir: string) => void;
}

async function defaultDownload(url: string, destFile: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new DoltUnavailableError(
      `dolt download failed: HTTP ${res.status} for ${url}`,
    );
  }
  writeFileSync(destFile, Buffer.from(await res.arrayBuffer()));
}

/**
 * Choose the extraction command. `.tar.gz` works with any `tar` (GNU or
 * bsdtar). `.zip` (only the Windows asset) needs bsdtar — and a git-bash
 * `tar` is msys GNU tar, which CANNOT read zip — so on win32 we invoke the
 * system bsdtar (`%SystemRoot%\System32\tar.exe`) by absolute path.
 */
export function extractInvocation(
  archive: string,
  destDir: string,
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
): { file: string; args: string[] } {
  if (archive.toLowerCase().endsWith('.zip') && platform === 'win32') {
    const sysRoot = env.SystemRoot ?? 'C:\\Windows';
    return {
      file: join(sysRoot, 'System32', 'tar.exe'),
      args: ['-xf', archive, '-C', destDir],
    };
  }
  return { file: 'tar', args: ['-xf', archive, '-C', destDir] };
}

function defaultExtract(archive: string, destDir: string): void {
  const { file, args } = extractInvocation(archive, destDir);
  execFileSync(file, args, { stdio: 'ignore' });
}

function findBinary(root: string, binName: string): string | undefined {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, entry.name);
    if (entry.isDirectory()) {
      const hit = findBinary(p, binName);
      if (hit) return hit;
    } else if (entry.name === binName) {
      return p;
    }
  }
  return undefined;
}

/**
 * Download + checksum-verify + unpack the pinned dolt into the managed cache.
 * Verification is fail-closed and happens BEFORE extraction. Never invoked
 * automatically — only via {@link ensureDoltAvailable} after explicit consent.
 */
export async function provisionDolt(opts: ProvisionOptions = {}): Promise<string> {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const arch = opts.arch ?? process.arch;
  const { url, sha256, asset } = doltAssetFor(
    platform,
    arch,
    opts.version ?? DOLT_PINNED_VERSION,
  );

  const work = mkdtempSync(join(tmpdir(), 'lw-dolt-dl-'));
  const archivePath = join(work, asset);
  await (opts.download ?? defaultDownload)(url, archivePath);

  verifyArchive(archivePath, sha256);

  const exdir = join(work, 'x');
  mkdirSync(exdir, { recursive: true });
  (opts.extract ?? defaultExtract)(archivePath, exdir);

  const binName = platform === 'win32' ? 'dolt.exe' : 'dolt';
  const found = findBinary(exdir, binName);
  if (!found) {
    throw new DoltUnavailableError(
      `extracted dolt archive did not contain ${binName}`,
    );
  }

  const targetDir = managedDoltDir(env);
  mkdirSync(targetDir, { recursive: true });
  const finalPath = join(targetDir, binName);
  copyFileSync(found, finalPath);
  try {
    chmodSync(finalPath, 0o755);
  } catch {
    /* no-op on Windows / restricted FS */
  }
  return finalPath;
}

export type DoltInstallReason = 'not-found' | 'explicit-path-missing';

export interface DoltInstallPrompt {
  reason: DoltInstallReason;
  /** Set when reason === 'explicit-path-missing'. */
  explicitPath?: string;
  targetDir: string;
  version: string;
  assetUrl: string;
}

/** UI-agnostic consent hook. Core never prompts directly; the CLI injects this. */
export type DoltConfirmFn = (
  prompt: DoltInstallPrompt,
) => boolean | Promise<boolean>;

export interface EnsureDoltOptions {
  /** REQUIRED: consent gate. Returning false means "do not install". */
  confirm: DoltConfirmFn;
  env?: Record<string, string | undefined>;
  resolve?: (o?: ResolveDoltOptions) => string;
  provision?: (o?: ProvisionOptions) => Promise<string>;
  platform?: NodeJS.Platform;
  arch?: string;
}

/**
 * Resolve dolt, installing it only with explicit consent. Rules:
 *  1. If dolt already resolves (override / managed cache / PATH) → return it;
 *     no prompt, no install.
 *  2. `confirm` is always awaited before any download/install.
 *  3. If LOREWEAVER_DOLT_BIN is set but its file is missing → NEVER auto-install;
 *     prompt with reason 'explicit-path-missing'. Declining yields an actionable
 *     error (fix the path, or re-run and approve a managed install).
 */
export async function ensureDoltAvailable(
  opts: EnsureDoltOptions,
): Promise<string> {
  const env = opts.env ?? process.env;
  const resolve = opts.resolve ?? resolveDoltBinary;

  try {
    return resolve({ env });
  } catch (err) {
    if (!(err instanceof DoltUnavailableError)) throw err;
  }

  const explicit = env.LOREWEAVER_DOLT_BIN?.trim();
  const platform = opts.platform ?? process.platform;
  const arch = opts.arch ?? process.arch;
  // Propagates DoltUnavailableError for unsupported platforms (cannot auto-install).
  const { url } = doltAssetFor(platform, arch);
  const targetDir = managedDoltDir(env);

  const approved = await opts.confirm({
    reason: explicit ? 'explicit-path-missing' : 'not-found',
    explicitPath: explicit,
    targetDir,
    version: DOLT_PINNED_VERSION,
    assetUrl: url,
  });

  if (!approved) {
    throw new DoltUnavailableError(
      explicit
        ? `LOREWEAVER_DOLT_BIN="${explicit}" was set but no file exists there, ` +
          `and a managed install was declined. Fix the path, or re-run and ` +
          `approve a managed install.`
        : `dolt not found and a managed install was declined. Set ` +
          `LOREWEAVER_DOLT_BIN to a dolt binary, or re-run and approve the ` +
          `managed install.`,
    );
  }

  return (opts.provision ?? provisionDolt)({ env, platform, arch });
}
