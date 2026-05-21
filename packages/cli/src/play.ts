import { createInterface } from 'node:readline/promises';
import {
  closeSessionGracefully,
  createCampaign,
  getCampaign,
  getSessionLaunchState,
  initSchema,
  startSession,
  type CampaignInfo,
  type CloseSessionGracefullyInput,
  type Db,
  type ModelClient,
  type ModulePack,
  type RunTurnDeps,
  type RunTurnInput,
  type RunTurnResult,
  type SessionLaunchState,
  type ToolRegistry,
} from '@loreweaver/core';

/**
 * Thin interactive front-end for the E6 session lifecycle.
 *
 * This module is a presentation layer only: it reads player input, prints DM
 * narration, and sequences create-campaign / launch / turn-loop / graceful-exit
 * by delegating every decision to the core. It contains NO game-rule logic —
 * no dice, no canon writes, no rulings. Turn execution goes to the core
 * orchestrator's `runTurn`; campaign and session lifecycle go to
 * `campaign.ts` / `session.ts` / `sessionClose.ts` / `sessionLaunch.ts`.
 *
 * Every core dependency and all I/O is injected through {@link PlayDeps}, so
 * the whole flow is testable without a terminal or a live model.
 */

/** Player-facing input/output seam. A terminal impl is {@link nodeIO}. */
export interface CliIO {
  /** Write one line of output to the player. */
  write(line: string): void;
  /**
   * Prompt the player and resolve with their trimmed answer, or `undefined`
   * when input is exhausted (EOF / closed stream) — which the turn loop treats
   * as a graceful quit.
   */
  prompt(question: string): Promise<string | undefined>;
}

export interface PlayDeps {
  io: CliIO;
  /** Open (creating the file if absent) the campaign database at a path. */
  openDb: (path: string) => Db;
  /** Model client powering the DM; passed straight to `runTurn`. */
  model: ModelClient;
  /** Tool registry passed straight to `runTurn`. */
  registry: ToolRegistry;
  /**
   * Run one orchestrated turn. Injected (rather than imported) so the loop is
   * exercisable in tests without a live model — defaults to the core `runTurn`.
   */
  runTurn: (deps: RunTurnDeps, input: RunTurnInput) => Promise<RunTurnResult>;
  /** Module template forked into a brand-new campaign. */
  pack: ModulePack;
  /** ISO-8601 timestamp source. */
  now: () => string;
  /** Unique id source for new campaigns / sessions / turns. */
  nextId: (prefix: string) => string;
  /** Per-turn RNG seed source (each turn is reproducible from its seed). */
  seed: () => number;
}

export interface PlayOptions {
  /** Path to the campaign database; created on first run. */
  dbPath: string;
}

/** Inputs that end the turn loop and trigger a graceful close. */
const QUIT_COMMANDS = new Set(['/quit', '/exit']);

/**
 * Run the interactive campaign front-end: open or create the campaign, launch
 * (resume an open session or start a new one), play turns, and on exit run the
 * graceful close pipeline. Returns a process exit code.
 */
export async function runPlay(
  deps: PlayDeps,
  options: PlayOptions,
): Promise<number> {
  const db = deps.openDb(options.dbPath);
  try {
    // initSchema is idempotent (CREATE IF NOT EXISTS), so this is safe whether
    // the database is brand-new or an existing campaign.
    initSchema(db);
    const campaign = resolveCampaign(deps, db);
    const sessionId = await launch(deps, db, campaign);
    await turnLoop(deps, db, campaign.campaignId, sessionId);
    return 0;
  } finally {
    db.close();
  }
}

/** Select the existing campaign, or create one from the module template. */
function resolveCampaign(deps: PlayDeps, db: Db): CampaignInfo {
  const existing = getCampaign(db);
  if (existing !== undefined) {
    deps.io.write(`Campaign: ${existing.title} (${existing.campaignId}).`);
    return existing;
  }
  const created = createCampaign(db, {
    campaignId: deps.nextId('campaign'),
    pack: deps.pack,
  });
  deps.io.write(
    `Created campaign '${created.campaignId}' from module: ${created.title}.`,
  );
  return created;
}

/**
 * Resolve which session to play. A crash leaves a session open; launch offers
 * the player Resume (reattach to the open session) or Close-and-recap (run the
 * close pipeline, then start fresh).
 */
async function launch(
  deps: PlayDeps,
  db: Db,
  campaign: CampaignInfo,
): Promise<string> {
  const state = getSessionLaunchState(db, { campaignId: campaign.campaignId });
  if (state.kind === 'start_new') {
    return startNewSession(deps, db, campaign.campaignId);
  }

  deps.io.write(
    `An unfinished session is open: ${state.session.sessionId} ` +
      `(started ${state.session.startedAt}).`,
  );
  renderSceneTail(deps.io, state);

  const answer = await deps.io.prompt(
    'Resume this session, or close it and recap? [resume/close] ',
  );
  const normalized = (answer ?? 'resume').toLowerCase();
  if (normalized === 'close' || normalized === 'c') {
    closeSessionGracefully(
      db,
      closeInput(deps, campaign.campaignId, state.session.sessionId),
    );
    deps.io.write('Previous session closed and recapped.');
    return startNewSession(deps, db, campaign.campaignId);
  }

  deps.io.write(`Resuming session ${state.session.sessionId}.`);
  return state.session.sessionId;
}

/** Replay the volatile tail of the open scene so a resumed player has context. */
function renderSceneTail(
  io: CliIO,
  state: Extract<SessionLaunchState, { kind: 'resume' }>,
): void {
  if (state.openScene === undefined || state.sceneTail.length === 0) {
    return;
  }
  io.write(`— Recent scene: ${state.openScene.title} —`);
  for (const entry of state.sceneTail) {
    io.write(`${entry.role}: ${entry.content}`);
  }
  io.write('—');
}

function startNewSession(deps: PlayDeps, db: Db, campaignId: string): string {
  const sessionId = deps.nextId('session');
  startSession(db, { campaignId, sessionId, startedAt: deps.now() });
  deps.io.write(
    `Started session ${sessionId}. Type /quit to save and exit.`,
  );
  return sessionId;
}

/**
 * Read player input and play turns until the player quits or input ends, then
 * run the graceful close pipeline. A failed turn is reported and play
 * continues — the orchestrator rolls a failed turn back, so pre-turn state is
 * intact.
 */
async function turnLoop(
  deps: PlayDeps,
  db: Db,
  campaignId: string,
  sessionId: string,
): Promise<void> {
  for (;;) {
    const input = await deps.io.prompt('> ');
    if (input === undefined || QUIT_COMMANDS.has(input.toLowerCase())) {
      break;
    }
    if (input.length === 0) {
      continue;
    }

    const result = await deps.runTurn(
      { db, model: deps.model, registry: deps.registry },
      {
        campaignId,
        sessionId,
        turnId: deps.nextId('turn'),
        playerInput: input,
        seed: deps.seed(),
        at: deps.now(),
      },
    );
    if (result.ok) {
      // Stream the DM's narration to the player. The core `complete` contract
      // returns a whole completion, so this is turn-granular streaming.
      deps.io.write(result.narration);
    } else {
      deps.io.write(
        `(the turn could not be completed: ${result.error ?? 'unknown error'}` +
          ' — your last input was not applied)',
      );
    }
  }

  const closed = closeSessionGracefully(
    db,
    closeInput(deps, campaignId, sessionId),
  );
  deps.io.write(
    `Session ${closed.session.sessionId} closed and recapped` +
      `${closed.checkpointId ? ` (checkpoint ${closed.checkpointId})` : ''}.`,
  );
}

/**
 * Build the graceful-close input. The recap is a factual stub: the CLI never
 * authors narrative — a model-generated session recap is a separate concern.
 */
function closeInput(
  deps: PlayDeps,
  campaignId: string,
  sessionId: string,
): CloseSessionGracefullyInput {
  const closedAt = deps.now();
  return {
    campaignId,
    sessionId,
    closedAt,
    recap: `Session ${sessionId} ended ${closedAt}.`,
    stateDelta: [],
  };
}

/**
 * A terminal-backed {@link CliIO} over Node's readline. `close()` releases the
 * readline interface; call it once the play flow returns.
 */
export function nodeIO(): CliIO & { close: () => void } {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    write: (line: string) => {
      process.stdout.write(`${line}\n`);
    },
    prompt: async (question: string) => {
      try {
        return (await rl.question(question)).trim();
      } catch {
        // The stream closed (EOF / Ctrl-D) — treat as end of input.
        return undefined;
      }
    },
    close: () => {
      rl.close();
    },
  };
}
