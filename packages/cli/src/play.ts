import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
  CheckpointStore,
  DEMO_TURN_CAP,
  DoltRepo,
  closeSessionGracefully,
  createCampaign,
  createDemoCampaign,
  getCampaign,
  getDemoTurnBudget,
  getSessionLaunchState,
  getSessionRecap,
  initSchema,
  listSessions,
  rollupArcSummary,
  startSession,
  type CampaignInfo,
  type CloseSessionGracefullyInput,
  type Db,
  type ModelClient,
  type ModulePack,
  type RunTurnDeps,
  type RunTurnInput,
  type RunTurnResult,
  type SessionCheckpointRunner,
  type SessionLaunchState,
  type SessionRecapRecord,
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
  /**
   * Build a checkpoint runner for the campaign DB at `dbPath`, or `undefined`
   * when checkpointing is unavailable (e.g. no `dolt` binary). Injected so the
   * close path is exercisable without Dolt; the default is
   * {@link doltCheckpointRunner}.
   */
  makeCheckpointRunner: (dbPath: string) => SessionCheckpointRunner | undefined;
}

export interface PlayOptions {
  /** Path to the campaign database; created on first run. */
  dbPath: string;
  /**
   * When set, the turn loop stops once this many player turns have been
   * recorded — the bounded-demo turn cap. Unset for an unbounded campaign.
   */
  turnCap?: number;
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
    const sessionId = await launch(deps, db, options.dbPath, campaign);
    await turnLoop(
      deps,
      db,
      options.dbPath,
      campaign.campaignId,
      sessionId,
      options.turnCap,
    );
    return 0;
  } finally {
    db.close();
  }
}

/**
 * Run the bounded public demo: an ordinary campaign restricted to demo-legal
 * content and capped at a turn budget. Creates a fresh demo campaign on first
 * run (or resumes an existing one), plays capped turns, and graceful-exits.
 * Returns a process exit code.
 */
export async function runDemo(
  deps: PlayDeps,
  options: PlayOptions,
): Promise<number> {
  const cap = options.turnCap ?? DEMO_TURN_CAP;
  const db = deps.openDb(options.dbPath);
  try {
    initSchema(db);
    const existing = getCampaign(db);
    let campaignId: string;
    let sessionId: string;
    if (existing === undefined) {
      const demo = createDemoCampaign(db, {
        campaignId: deps.nextId('campaign'),
        sessionId: deps.nextId('session'),
        startedAt: deps.now(),
        pack: deps.pack,
        turnCap: cap,
      });
      campaignId = demo.campaignId;
      sessionId = demo.session.sessionId;
      deps.io.write(`Demo campaign '${demo.campaignId}' — ${demo.packTitle}.`);
      deps.io.write(
        `Bounded demo: ${demo.turnCap} turns. Type /quit to save and exit.`,
      );
      if (demo.model.disclaimer !== undefined) {
        deps.io.write(demo.model.disclaimer);
      }
    } else {
      campaignId = existing.campaignId;
      deps.io.write(`Demo campaign: ${existing.title} (${existing.campaignId}).`);
      sessionId = await launch(deps, db, options.dbPath, existing);
    }
    await turnLoop(deps, db, options.dbPath, campaignId, sessionId, cap);
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
  dbPath: string,
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
    gracefulClose(deps, db, dbPath, campaign.campaignId, state.session.sessionId);
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
  dbPath: string,
  campaignId: string,
  sessionId: string,
  turnCap?: number,
): Promise<void> {
  for (;;) {
    if (turnCap !== undefined) {
      const budget = getDemoTurnBudget(db, { campaignId, sessionId, turnCap });
      if (budget.capReached) {
        deps.io.write(
          `Demo turn cap reached (${budget.turnsUsed}/${budget.turnCap}). ` +
            'Start a full campaign to keep playing.',
        );
        break;
      }
    }
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

  gracefulClose(deps, db, dbPath, campaignId, sessionId);
}

/**
 * Run the graceful close pipeline and report the outcome. When a checkpoint
 * runner is available the close also snapshots campaign canon to Dolt; when it
 * is not (e.g. Dolt is not installed) the session still closes and recaps —
 * checkpointing is optional and never blocks a clean exit. A checkpoint that
 * fails after the session is already marked closed is reported, not fatal.
 */
function gracefulClose(
  deps: PlayDeps,
  db: Db,
  dbPath: string,
  campaignId: string,
  sessionId: string,
): void {
  const input = closeInput(deps, campaignId, sessionId);
  const checkpoint = deps.makeCheckpointRunner(dbPath);
  if (checkpoint === undefined) {
    const closed = closeSessionGracefully(db, input);
    deps.io.write(
      `Session ${closed.session.sessionId} closed and recapped ` +
        '(no checkpoint — Dolt is not available).',
    );
  } else {
    try {
      const closed = closeSessionGracefully(db, { ...input, checkpoint });
      deps.io.write(
        `Session ${closed.session.sessionId} closed and recapped` +
          `${closed.checkpointId ? ` (checkpoint ${closed.checkpointId})` : ''}.`,
      );
    } catch (error) {
      // closeSessionGracefully marks the session closed and writes the recap
      // BEFORE running the checkpoint, so a checkpoint failure still leaves a
      // fully closed, recapped session — only the Dolt snapshot is missing.
      deps.io.write(
        `Session ${sessionId} closed and recapped, but the checkpoint ` +
          `failed: ${error instanceof Error ? error.message : String(error)}.`,
      );
    }
  }
  // The session is now closed and recapped on every path above (the recap is
  // written before the checkpoint, so a checkpoint failure does not skip it).
  // Roll the campaign's arc up so the arc tier of the memory pyramid reflects
  // the closed session.
  rollupCampaignArc(deps, db, campaignId);
}

/** The campaign's single ongoing arc. Multi-arc support is future work. */
const CAMPAIGN_ARC_ID = 'arc-1';

/**
 * Roll the campaign's closed sessions up into its arc summary, so the arc tier
 * of the memory pyramid stays current and `assembleContext` can surface it.
 *
 * The arc summary is composed mechanically by joining the session recaps; a
 * model-authored arc summary is future work and tracked with the session-recap
 * rollup (loreweaver-32m). The campaign bible is reconciled with no new entries
 * — populating world facts / NPCs / factions / threads needs an extraction
 * source and is deferred — but the row is created so the tier is live.
 */
function rollupCampaignArc(
  deps: PlayDeps,
  db: Db,
  campaignId: string,
): void {
  const recaps = listSessions(db, { campaignId })
    .map((session) => getSessionRecap(db, { campaignId, sessionId: session.sessionId }))
    .filter((recap): recap is SessionRecapRecord => recap !== undefined);
  if (recaps.length === 0) {
    return;
  }
  rollupArcSummary(db, {
    campaignId,
    arcId: CAMPAIGN_ARC_ID,
    summary: recaps.map((recap) => recap.recap).join(' '),
    sourceSessionIds: recaps.map((recap) => recap.sessionId),
    campaignBible: {
      worldFacts: [],
      majorNpcs: [],
      factions: [],
      openThreads: [],
    },
    createdAt: deps.now(),
  });
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
 * Default {@link PlayDeps.makeCheckpointRunner}: a Dolt-backed checkpoint
 * runner for the campaign DB, or `undefined` when no `dolt` binary is
 * resolvable. The checkpoint repo lives in `<dbPath>.checkpoints`, kept
 * disjoint from any beads Dolt repo (the {@link CheckpointStore} separation
 * guard enforces it).
 */
export function doltCheckpointRunner(
  dbPath: string,
): SessionCheckpointRunner | undefined {
  if (!DoltRepo.available()) {
    return undefined;
  }
  const doltDir = `${dbPath}.checkpoints`;
  const beadsDir = join(dirname(dbPath), '.beads');
  return {
    liveDbPath: dbPath,
    run: (liveDbPath, message) =>
      new CheckpointStore(doltDir, beadsDir).checkpoint(liveDbPath, message),
  };
}

/**
 * A terminal-backed {@link CliIO} over Node's readline. `close()` releases the
 * readline interface; call it once the play flow returns.
 */
export function nodeIO(): CliIO & { close: () => void } {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // On stdin EOF (Ctrl-D) or a closed stream, readline emits 'close' and a
  // pending `rl.question()` then never settles — it does not reject. A bare
  // `await rl.question()` would hang the turn loop forever and silently skip
  // the graceful close pipeline. Track the close and race every prompt against
  // it so a closed stream resolves as end-of-input (`undefined`) instead.
  let closed = false;
  const onClose = new Promise<undefined>((resolve) => {
    rl.once('close', () => {
      closed = true;
      resolve(undefined);
    });
  });
  return {
    write: (line: string) => {
      process.stdout.write(`${line}\n`);
    },
    prompt: async (question: string) => {
      if (closed) {
        return undefined;
      }
      try {
        // Whichever settles first wins: a typed answer, or stdin closing.
        const answer = await Promise.race([rl.question(question), onClose]);
        return answer?.trim();
      } catch {
        // Defensive: any other readline failure is also end of input.
        return undefined;
      }
    },
    close: () => {
      rl.close();
    },
  };
}
