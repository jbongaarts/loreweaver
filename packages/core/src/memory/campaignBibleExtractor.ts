import type {
  ModelClient,
  ModelCompleteInput,
  ModelMessage,
} from '../model/client.js';
import type { CampaignBibleInput, SessionRecapRecord } from './summary.js';
import { MemorySummaryError } from './summary.js';

const BIBLE_EXTRACTOR_SYSTEM_PROMPT = [
  'You extract structured world facts from session recaps of a fantasy tabletop campaign.',
  'Read the chronological session recaps in the user message and identify:',
  '- worldFacts: durable facts about the setting (places, magic, weather, geography)',
  '- majorNpcs: named non-player characters who have appeared',
  '- factions: named groups, organizations, or political entities',
  '- openThreads: unresolved plot threads, dangling questions, hooks for future play',
  'Each entry must be a short noun phrase or sentence under 20 words.',
  'Output ONLY a fenced JSON block tagged "bible_json" with this exact shape:',
  '```bible_json',
  '{"worldFacts":[],"majorNpcs":[],"factions":[],"openThreads":[]}',
  '```',
  'Do not include any other text outside the fenced block.',
].join('\n');

const BIBLE_FENCE = /```bible_json\s*\n([\s\S]*?)\n?```/;

export interface ExtractCampaignBibleInput {
  campaignId: string;
  recaps: SessionRecapRecord[];
}

export async function extractCampaignBible(
  model: ModelClient,
  input: ExtractCampaignBibleInput,
): Promise<CampaignBibleInput> {
  const userContent = renderRecaps(input.recaps);
  const messages: ModelMessage[] = [{ role: 'user', content: userContent }];
  const raw = await model.complete({
    system: BIBLE_EXTRACTOR_SYSTEM_PROMPT,
    messages,
  });
  return parseBibleResponse(raw);
}

function parseBibleResponse(raw: string): CampaignBibleInput {
  const match = BIBLE_FENCE.exec(raw);
  if (match === null) {
    throw new MemorySummaryError(
      'campaign bible response missing fenced bible_json block',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch (error) {
    throw new MemorySummaryError(
      'campaign bible response could not be parsed as JSON: ' +
        (error instanceof Error ? error.message : String(error)),
    );
  }
  if (!isCampaignBibleInput(parsed)) {
    throw new MemorySummaryError(
      'campaign bible response did not match the {worldFacts, majorNpcs, factions, openThreads}: string[] shape',
    );
  }
  return parsed;
}

function isCampaignBibleInput(value: unknown): value is CampaignBibleInput {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    isStringArray(obj.worldFacts) &&
    isStringArray(obj.majorNpcs) &&
    isStringArray(obj.factions) &&
    isStringArray(obj.openThreads)
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function renderRecaps(recaps: SessionRecapRecord[]): string {
  const blocks = recaps.map((recap) => {
    const delta =
      recap.stateDelta.length === 0
        ? '(no canon mutations)'
        : recap.stateDelta
            .map((entry) => '  - ' + JSON.stringify(entry))
            .join('\n');
    return [
      '## ' + recap.sessionId + ' (' + recap.createdAt + ')',
      recap.recap,
      'Canon mutations:',
      delta,
    ].join('\n');
  });
  return blocks.join('\n\n');
}
