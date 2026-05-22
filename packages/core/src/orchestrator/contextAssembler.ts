import type { Db } from '../persistence/db.js';
import { jsonColumn } from '../persistence/jsonColumn.js';
import {
  getArcSummary,
  selectAlwaysOnMemory,
} from '../memory/summary.js';
import type {
  ArcSummaryRecord,
  CampaignBibleRecord,
  SessionRecapRecord,
} from '../memory/summary.js';
import { getOpenScene, listSceneLog } from './scene.js';
import type { SceneLogRecord } from './scene.js';

/**
 * Bounded Context Assembler (E5).
 *
 * Builds the per-turn prompt from a deliberately bounded slice — campaign
 * bible, current arc summary, recent session recap(s), the full structured
 * state snapshot, and the current scene's live transcript. Older turn history
 * is excluded by construction: closed scenes live in scene_summary and are
 * reached only via the `memory_drilldown` tool. Slices stay compact so the
 * stable head of the prompt is friendly to provider prompt caching.
 *
 * Fills the ContextAssembler seam.
 */

const DEFAULT_RECENT_SESSION_LIMIT = 1;

/** JSON codecs for the JSON-backed state columns the assembler reads. */
const plotFlagValueColumn = jsonColumn<unknown>('plot_flags.value_json');
const abilityScoresColumn = jsonColumn<Record<string, unknown>>(
  'character.ability_scores_json',
);
const conditionsColumn = jsonColumn<unknown[]>('character.conditions_json');
const inventoryPropertiesColumn = jsonColumn<Record<string, unknown>>(
  'inventory.properties_json',
);

export interface ContextAssemblyInput {
  db: Db;
  campaignId: string;
  sessionId: string;
  /** Current arc, if the campaign has rolled one up. */
  arcId?: string;
  playerInput: string;
  /** How many recent session recaps to inline. Default 1. */
  recentSessionLimit?: number;
}

export interface CharacterSnapshot {
  name: string | undefined;
  ancestry: string | undefined;
  className: string | undefined;
  level: number;
  hpCurrent: number;
  hpMax: number;
  abilityScores: Record<string, unknown>;
  conditions: unknown[];
}

export interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  location: string | undefined;
  properties: Record<string, unknown>;
}

export interface ClockSnapshot {
  inGameTime: string;
  currentLocationId: string | undefined;
}

export interface StateSnapshot {
  character: CharacterSnapshot;
  inventory: InventoryItem[];
  plotFlags: Record<string, unknown>;
  clock: ClockSnapshot;
}

export interface AssembledSceneRef {
  sceneId: string;
  title: string;
}

export interface AssembledContext {
  campaignId: string;
  sessionId: string;
  campaignBible: CampaignBibleRecord | undefined;
  arcSummary: ArcSummaryRecord | undefined;
  recentSessionRecaps: SessionRecapRecord[];
  omittedSessionCount: number;
  drilldownAvailable: boolean;
  state: StateSnapshot;
  scene: AssembledSceneRef | undefined;
  sceneTranscript: SceneLogRecord[];
  playerInput: string;
}

interface CharacterRow {
  name: string | null;
  ancestry: string | null;
  class_name: string | null;
  level: number;
  hp_current: number;
  hp_max: number;
  ability_scores_json: string;
  conditions_json: string;
}

interface InventoryRow {
  id: string;
  name: string;
  quantity: number;
  location: string | null;
  properties_json: string;
}

interface ClockRow {
  in_game_time: string;
  current_location_id: string | null;
}

interface KeyedJsonRow {
  key: string;
  value_json: string;
}

export function readStateSnapshot(db: Db): StateSnapshot {
  const character = db
    .prepare(
      `SELECT name, ancestry, class_name, level, hp_current, hp_max,
              ability_scores_json, conditions_json
       FROM character WHERE id = 1`,
    )
    .get() as CharacterRow;

  const inventoryRows = db
    .prepare(
      `SELECT id, name, quantity, location, properties_json
       FROM inventory ORDER BY id`,
    )
    .all() as InventoryRow[];

  const clock = db
    .prepare(
      `SELECT in_game_time, current_location_id FROM clock WHERE id = 1`,
    )
    .get() as ClockRow;

  const plotFlagRows = db
    .prepare(`SELECT key, value_json FROM plot_flags ORDER BY key`)
    .all() as KeyedJsonRow[];

  const plotFlags: Record<string, unknown> = {};
  for (const row of plotFlagRows) {
    plotFlags[row.key] = plotFlagValueColumn.decode(row.value_json);
  }

  return {
    character: {
      name: character.name ?? undefined,
      ancestry: character.ancestry ?? undefined,
      className: character.class_name ?? undefined,
      level: character.level,
      hpCurrent: character.hp_current,
      hpMax: character.hp_max,
      abilityScores: abilityScoresColumn.decode(character.ability_scores_json),
      conditions: conditionsColumn.decode(character.conditions_json),
    },
    inventory: inventoryRows.map((row) => ({
      id: row.id,
      name: row.name,
      quantity: row.quantity,
      location: row.location ?? undefined,
      properties: inventoryPropertiesColumn.decode(row.properties_json),
    })),
    plotFlags,
    clock: {
      inGameTime: clock.in_game_time,
      currentLocationId: clock.current_location_id ?? undefined,
    },
  };
}

export function assembleContext(
  input: ContextAssemblyInput,
): AssembledContext {
  const recentSessionLimit =
    input.recentSessionLimit ?? DEFAULT_RECENT_SESSION_LIMIT;

  const alwaysOn = selectAlwaysOnMemory(input.db, {
    campaignId: input.campaignId,
    recentSessionLimit,
  });

  const arcSummary =
    input.arcId === undefined
      ? undefined
      : getArcSummary(input.db, {
          campaignId: input.campaignId,
          arcId: input.arcId,
        });

  const openScene = getOpenScene(input.db, {
    campaignId: input.campaignId,
    sessionId: input.sessionId,
  });

  const sceneTranscript =
    openScene === undefined
      ? []
      : listSceneLog(input.db, {
          campaignId: input.campaignId,
          sessionId: input.sessionId,
          sceneId: openScene.sceneId,
        });

  return {
    campaignId: input.campaignId,
    sessionId: input.sessionId,
    campaignBible: alwaysOn.campaignBible,
    arcSummary,
    recentSessionRecaps: alwaysOn.recentSessionRecaps.filter(
      (r): r is SessionRecapRecord => r !== undefined,
    ),
    omittedSessionCount: alwaysOn.omittedSessionCount,
    drilldownAvailable: alwaysOn.drilldownAvailable,
    state: readStateSnapshot(input.db),
    scene:
      openScene === undefined
        ? undefined
        : { sceneId: openScene.sceneId, title: openScene.title },
    sceneTranscript,
    playerInput: input.playerInput,
  };
}

function renderState(state: StateSnapshot): string {
  const c = state.character;
  const lines = [
    `Character: ${c.name ?? '(unnamed)'} — ${c.ancestry ?? '?'} ${
      c.className ?? '?'
    }, level ${c.level}, HP ${c.hpCurrent}/${c.hpMax}`,
  ];
  if (c.conditions.length > 0) {
    lines.push(`Conditions: ${JSON.stringify(c.conditions)}`);
  }
  if (state.inventory.length > 0) {
    lines.push(
      `Inventory: ${state.inventory
        .map((i) => `${i.name} x${i.quantity}`)
        .join(', ')}`,
    );
  }
  const flagKeys = Object.keys(state.plotFlags);
  if (flagKeys.length > 0) {
    lines.push(`Plot flags: ${JSON.stringify(state.plotFlags)}`);
  }
  lines.push(
    `Clock: ${state.clock.inGameTime || '(unset)'}${
      state.clock.currentLocationId
        ? ` @ ${state.clock.currentLocationId}`
        : ''
    }`,
  );
  return lines.join('\n');
}

/**
 * Render the assembled context into the user-message text handed to the model.
 * The DM system prompt is supplied separately by the orchestrator.
 */
export function renderContextMessage(ctx: AssembledContext): string {
  const sections: string[] = [];

  if (ctx.campaignBible !== undefined) {
    const bible = ctx.campaignBible;
    const facts = [
      ...bible.worldFacts.map((e) => `- world: ${e.text}`),
      ...bible.majorNpcs.map((e) => `- npc: ${e.text}`),
      ...bible.factions.map((e) => `- faction: ${e.text}`),
      ...bible.openThreads.map((e) => `- thread: ${e.text}`),
    ];
    if (facts.length > 0) {
      sections.push(`## Campaign Bible\n${facts.join('\n')}`);
    }
  }

  if (ctx.arcSummary !== undefined) {
    sections.push(`## Current Arc\n${ctx.arcSummary.summary}`);
  }

  if (ctx.recentSessionRecaps.length > 0) {
    sections.push(
      `## Recent Sessions\n${ctx.recentSessionRecaps
        .map((r) => `- ${r.recap}`)
        .join('\n')}`,
    );
  }
  if (ctx.drilldownAvailable) {
    sections.push(
      `_${ctx.omittedSessionCount} older session(s) omitted — use memory_drilldown to retrieve them._`,
    );
  }

  sections.push(`## Game State\n${renderState(ctx.state)}`);

  if (ctx.scene !== undefined) {
    const transcript =
      ctx.sceneTranscript.length > 0
        ? ctx.sceneTranscript
            .map((e) => `${e.role === 'player' ? 'Player' : 'DM'}: ${e.content}`)
            .join('\n')
        : '(no turns yet)';
    sections.push(`## Current Scene: ${ctx.scene.title}\n${transcript}`);
  } else {
    sections.push('## Current Scene\n(no scene open)');
  }

  sections.push(`## Player Input\n${ctx.playerInput}`);

  return sections.join('\n\n');
}
