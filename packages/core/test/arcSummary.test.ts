import { describe, expect, it } from 'vitest';
import {
  composeArcSummary,
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

describe('composeArcSummary', () => {
  it('returns the model-authored summary text verbatim', async () => {
    const model = fakeModel(() => 'You opened the wayhouse door.');
    const summary = await composeArcSummary(model, {
      campaignId: 'camp-1',
      arcId: 'arc-1',
      recaps: [
        recap('session-1', 'Mira found the chalk sigil.', '2026-05-20T10:00:00.000Z'),
        recap('session-2', 'The warden welcomed you in.', '2026-05-21T10:00:00.000Z'),
      ],
    });
    expect(summary).toBe('You opened the wayhouse door.');
  });

  it('renders each session recap and stateDelta into the user prompt', async () => {
    let captured: ModelCompleteInput | undefined;
    const model = fakeModel((input) => {
      captured = input;
      return 'OK';
    });
    await composeArcSummary(model, {
      campaignId: 'camp-1',
      arcId: 'arc-1',
      recaps: [
        recap('session-1', 'Mira found the chalk sigil.', '2026-05-20T10:00:00.000Z', [
          { target: 'plot_flags', field: 'found_sigil', op: 'set', value: true },
        ]),
      ],
    });
    expect(captured?.system).toMatch(/continuity primer/i);
    expect(captured?.messages).toHaveLength(1);
    const userContent = captured?.messages[0].content ?? '';
    expect(userContent).toContain('session-1');
    expect(userContent).toContain('Mira found the chalk sigil.');
    expect(userContent).toContain('found_sigil');
  });
});
