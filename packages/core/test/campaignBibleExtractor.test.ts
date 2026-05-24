import { describe, expect, it } from 'vitest';
import {
  extractCampaignBible,
  ModelClientError,
  MemorySummaryError,
  type ModelClient,
  type ModelCompleteInput,
  type SessionRecapRecord,
} from '../src/index.js';

function fakeModel(
  handler: (input: ModelCompleteInput) => Promise<string> | string,
): ModelClient {
  return { complete: async (input) => handler(input) };
}

function recap(
  sessionId: string,
  text: string,
  createdAt: string,
  stateDelta: SessionRecapRecord['stateDelta'] = [],
): SessionRecapRecord {
  return {
    campaignId: 'camp-1',
    sessionId,
    recap: text,
    sourceSceneIds: [],
    stateDelta,
    createdAt,
    updatedAt: createdAt,
  };
}

const VALID_BIBLE_OUTPUT =
  '```bible_json\n' +
  '{\n' +
  '  "worldFacts": ["Emberfall sits on a fault line", "The Lantern Court rules the city"],\n' +
  '  "majorNpcs": ["Mira the runesmith", "Warden Hess"],\n' +
  '  "factions": ["Lantern Court", "Cellar Cabal"],\n' +
  '  "openThreads": ["The chalk sigil is unsolved", "The warden hinted at a debt"]\n' +
  '}\n' +
  '```';

describe('extractCampaignBible', () => {
  it('parses a valid fenced bible_json block from the model', async () => {
    const model = fakeModel(() => VALID_BIBLE_OUTPUT);
    const bible = await extractCampaignBible(model, {
      campaignId: 'camp-1',
      recaps: [
        recap('session-1', 'Mira found the chalk sigil.', '2026-05-20T10:00:00.000Z'),
      ],
    });
    expect(bible.worldFacts).toEqual([
      'Emberfall sits on a fault line',
      'The Lantern Court rules the city',
    ]);
    expect(bible.majorNpcs).toEqual(['Mira the runesmith', 'Warden Hess']);
    expect(bible.factions).toEqual(['Lantern Court', 'Cellar Cabal']);
    expect(bible.openThreads).toEqual([
      'The chalk sigil is unsolved',
      'The warden hinted at a debt',
    ]);
  });

  it('renders each session recap into the user prompt', async () => {
    let captured: ModelCompleteInput | undefined;
    const model = fakeModel((input) => {
      captured = input;
      return VALID_BIBLE_OUTPUT;
    });
    await extractCampaignBible(model, {
      campaignId: 'camp-1',
      recaps: [
        recap('session-1', 'Mira found the chalk sigil.', '2026-05-20T10:00:00.000Z'),
      ],
    });
    expect(captured?.system).toMatch(/world facts/i);
    expect(captured?.messages).toHaveLength(1);
    const userContent = captured?.messages[0].content ?? '';
    expect(userContent).toContain('session-1');
    expect(userContent).toContain('Mira found the chalk sigil.');
  });

  it('throws MemorySummaryError when the model response has no fenced bible_json block', async () => {
    const model = fakeModel(() => 'Here is the bible: {"worldFacts": []}');
    await expect(
      extractCampaignBible(model, {
        campaignId: 'camp-1',
        recaps: [recap('session-1', 'r', '2026-05-20T10:00:00.000Z')],
      }),
    ).rejects.toBeInstanceOf(MemorySummaryError);
  });

  it('throws MemorySummaryError when the fenced content is not valid JSON', async () => {
    const model = fakeModel(
      () => '```bible_json\nnot json at all\n```',
    );
    await expect(
      extractCampaignBible(model, {
        campaignId: 'camp-1',
        recaps: [recap('session-1', 'r', '2026-05-20T10:00:00.000Z')],
      }),
    ).rejects.toBeInstanceOf(MemorySummaryError);
  });

  it('throws MemorySummaryError when the JSON has the wrong shape', async () => {
    const model = fakeModel(
      () =>
        '```bible_json\n{"worldFacts": ["ok"], "majorNpcs": ["ok"]}\n```',
    );
    await expect(
      extractCampaignBible(model, {
        campaignId: 'camp-1',
        recaps: [recap('session-1', 'r', '2026-05-20T10:00:00.000Z')],
      }),
    ).rejects.toBeInstanceOf(MemorySummaryError);
  });

  it('propagates ModelClientError from the provider', async () => {
    const model: ModelClient = {
      complete: async () => {
        throw new ModelClientError('boom');
      },
    };
    await expect(
      extractCampaignBible(model, {
        campaignId: 'camp-1',
        recaps: [recap('session-1', 'r', '2026-05-20T10:00:00.000Z')],
      }),
    ).rejects.toBeInstanceOf(ModelClientError);
  });

  it('throws MemorySummaryError when recaps is empty', async () => {
    const model: ModelClient = {
      complete: async () => 'unused',
    };
    await expect(
      extractCampaignBible(model, {
        campaignId: 'camp-1',
        recaps: [],
      }),
    ).rejects.toBeInstanceOf(MemorySummaryError);
  });
});
