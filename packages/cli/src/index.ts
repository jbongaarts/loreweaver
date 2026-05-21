#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import {
  AgentSdkModelClient,
  CORE_VERSION,
  ConfigError,
  DEMO_TURN_CAP,
  EMBERFALL_HOLLOW,
  createDefaultToolRegistry,
  ensureDoltAvailable,
  loadConfig,
  openDatabase,
  runTurn,
  type DoltInstallPrompt,
  type EnsureDoltOptions,
  type LoreweaverConfig,
} from '@loreweaver/core';
import {
  doltCheckpointRunner,
  nodeIO,
  runDemo,
  runPlay,
  type PlayDeps,
} from './play.js';

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

/**
 * Build the real, terminal-and-model-backed dependencies for `loreweaver play`.
 * Ids embed a timestamp plus randomness so they are unique and order-stable.
 */
function buildPlayDeps(cfg: LoreweaverConfig, io: PlayDeps['io']): PlayDeps {
  return {
    io,
    openDb: (path) => openDatabase(path),
    model: new AgentSdkModelClient(cfg.model),
    registry: createDefaultToolRegistry(),
    runTurn,
    pack: EMBERFALL_HOLLOW,
    now: () => new Date().toISOString(),
    nextId: (prefix) =>
      `${prefix}-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    seed: () => (Math.random() * 0x7fffffff) | 0,
    makeCheckpointRunner: doltCheckpointRunner,
  };
}

/**
 * Load config, or report a {@link ConfigError} to stderr and yield an exit
 * code. Shared by the `play` and `demo` subcommands.
 */
function loadCliConfig():
  | { ok: true; cfg: LoreweaverConfig }
  | { ok: false; code: number } {
  try {
    return { ok: true, cfg: loadConfig() };
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`config error: ${err.message}`);
      return { ok: false, code: 1 };
    }
    throw err;
  }
}

/** `loreweaver play` — the interactive campaign front-end. */
export async function runPlaySubcommand(): Promise<number> {
  const config = loadCliConfig();
  if (!config.ok) {
    return config.code;
  }
  const io = nodeIO();
  try {
    return await runPlay(buildPlayDeps(config.cfg, io), {
      dbPath: config.cfg.campaignDbPath,
    });
  } finally {
    io.close();
  }
}

/** Demo campaign DB path: a sibling of the configured campaign DB. */
function demoDbPath(campaignDbPath: string): string {
  return join(dirname(campaignDbPath), 'loreweaver-demo.db');
}

/** `loreweaver demo` — the bounded public demo campaign. */
export async function runDemoSubcommand(): Promise<number> {
  const config = loadCliConfig();
  if (!config.ok) {
    return config.code;
  }
  const io = nodeIO();
  try {
    return await runDemo(buildPlayDeps(config.cfg, io), {
      dbPath: demoDbPath(config.cfg.campaignDbPath),
      turnCap: DEMO_TURN_CAP,
    });
  } finally {
    io.close();
  }
}

export function main(argv: string[] = process.argv): void {
  if (argv[2] === 'dolt' && argv[3] === 'install') {
    void runDoltInstall().then((code) => {
      process.exitCode = code;
    });
    return;
  }

  if (argv[2] === 'play') {
    void runPlaySubcommand().then((code) => {
      process.exitCode = code;
    });
    return;
  }

  if (argv[2] === 'demo') {
    void runDemoSubcommand().then((code) => {
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
