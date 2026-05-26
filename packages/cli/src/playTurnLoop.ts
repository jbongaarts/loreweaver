import type { Db } from '@loreweaver/core';
import { getDemoTurnBudget } from '@loreweaver/core';
import { gracefulClose } from './playClose.js';
import type { PlayDeps } from './playTypes.js';

/** Inputs that end the turn loop and trigger a graceful close. */
const QUIT_COMMANDS = new Set(['/quit', '/exit']);

/**
 * Read player input and play turns until the player quits or input ends, then
 * run the graceful close pipeline. A failed turn is reported and play
 * continues — the orchestrator rolls a failed turn back, so pre-turn state is
 * intact.
 */
export async function turnLoop(
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
          `Demo turn cap reached (${budget.turnsUsed}/${budget.turnCap}). Start a full campaign to keep playing.`,
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
        recentSessionLimit: deps.memoryConfig.recapWindowSize,
      },
    );
    if (result.ok) {
      // Turn-granular output: `ModelClient.complete` returns a whole completion
      // and `runTurn` resolves once the turn is finished, so narration is
      // written in one shot rather than streamed token-by-token (see ADR 0002).
      deps.io.write(result.narration);
    } else {
      deps.io.write(
        `(the turn could not be completed: ${result.error ?? 'unknown error'} — your last input was not applied)`,
      );
    }
  }

  await gracefulClose(deps, db, dbPath, campaignId, sessionId);
}
