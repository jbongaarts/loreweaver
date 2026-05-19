import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import {
  CORE_VERSION,
  ConfigError,
  ensureDoltAvailable,
  loadConfig,
  type DoltInstallPrompt,
  type EnsureDoltOptions,
} from '@loreweaver/core';

export function buildBanner(version: string): string {
  return `Loreweaver — core v${version}`;
}

/**
 * Interactive consent for a managed dolt install. Default answer is NO, and a
 * non-interactive stdin always declines so automation/CI can never trigger an
 * unattended binary download.
 */
export async function ttyConfirm(prompt: DoltInstallPrompt): Promise<boolean> {
  const head =
    prompt.reason === 'explicit-path-missing'
      ? `LOREWEAVER_DOLT_BIN="${prompt.explicitPath}" is set, but no file exists there.`
      : 'dolt was not found (PATH, managed cache, or LOREWEAVER_DOLT_BIN).';
  console.log(head);
  console.log(
    `Proposed: download dolt ${prompt.version} and install it to ${prompt.targetDir}`,
  );
  console.log(`Source:   ${prompt.assetUrl} (sha256-verified, fail-closed)`);
  if (!process.stdin.isTTY) {
    console.log('Non-interactive shell — declining automatically.');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = (
      await rl.question('Install managed dolt now? [y/N] ')
    )
      .trim()
      .toLowerCase();
    return ans === 'y' || ans === 'yes';
  } finally {
    rl.close();
  }
}

export interface DoltInstallDeps {
  ensure?: (opts: EnsureDoltOptions) => Promise<string>;
  confirm?: EnsureDoltOptions['confirm'];
  log?: (message: string) => void;
}

/** `loreweaver dolt install` — installs only if dolt is absent and consented. */
export async function runDoltInstall(
  deps: DoltInstallDeps = {},
): Promise<number> {
  const ensure = deps.ensure ?? ensureDoltAvailable;
  const confirm = deps.confirm ?? ttyConfirm;
  const log = deps.log ?? ((m: string) => console.log(m));
  try {
    const path = await ensure({ confirm });
    log(`dolt ready: ${path}`);
    return 0;
  } catch (err) {
    log(`dolt unavailable: ${(err as Error).message}`);
    return 1;
  }
}

export function main(argv: string[] = process.argv): void {
  if (argv[2] === 'dolt' && argv[3] === 'install') {
    void runDoltInstall().then((code) => {
      process.exitCode = code;
    });
    return;
  }

  console.log(buildBanner(CORE_VERSION));
  try {
    const cfg = loadConfig();
    console.log(`db=${cfg.campaignDbPath} model=${cfg.model}`);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`config error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
