import { describe, expect, it } from 'vitest';
import {
  getTurnTrace,
  initSchema,
  openDatabase,
  recordTurnTrace,
} from '../src/internal.js';

describe('structured turn traces', () => {
  it('records a consent-scoped turn trace separate from public content', () => {
    const db = openDatabase(':memory:');
    initSchema(db);

    recordTurnTrace(db, {
      campaignId: 'campaign-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      consentScope: 'private',
      playerInput: 'I search the ruined shrine.',
      retrievedContext: [{ kind: 'scene_summary', id: 'scene-1' }],
      promptProfile: 'premium_dm',
      modelOutput: 'The shrine smells of rain and old ash.',
      toolCalls: [{ name: 'lookup_rules', args: { name: 'Perception' } }],
      rulesResolution: { check: 'Wisdom (Perception)', dc: 13, result: 16 },
      acceptedStateDelta: [
        {
          target: 'plot_flags',
          field: 'found_shrine_tracks',
          op: 'set',
          value: true,
        },
      ],
      rejectedCandidates: [{ reason: 'unsupported canon claim' }],
      finalNarration: 'You find fresh bootprints near the altar.',
      memoryUpdates: [{ type: 'scene_summary', id: 'scene-2' }],
      humanCorrections: ['The shrine is dedicated to the moon, not the sun.'],
      qualityFlags: ['canon_checked', 'rules_checked'],
      createdAt: '2026-05-19T05:00:00.000Z',
    });

    expect(
      getTurnTrace(db, {
        campaignId: 'campaign-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
      }),
    ).toEqual({
      campaignId: 'campaign-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      consentScope: 'private',
      playerInput: 'I search the ruined shrine.',
      retrievedContext: [{ kind: 'scene_summary', id: 'scene-1' }],
      promptProfile: 'premium_dm',
      modelOutput: 'The shrine smells of rain and old ash.',
      toolCalls: [{ name: 'lookup_rules', args: { name: 'Perception' } }],
      rulesResolution: { check: 'Wisdom (Perception)', dc: 13, result: 16 },
      acceptedStateDelta: [
        {
          target: 'plot_flags',
          field: 'found_shrine_tracks',
          op: 'set',
          value: true,
        },
      ],
      rejectedCandidates: [{ reason: 'unsupported canon claim' }],
      finalNarration: 'You find fresh bootprints near the altar.',
      memoryUpdates: [{ type: 'scene_summary', id: 'scene-2' }],
      humanCorrections: ['The shrine is dedicated to the moon, not the sun.'],
      qualityFlags: ['canon_checked', 'rules_checked'],
      createdAt: '2026-05-19T05:00:00.000Z',
    });

    const traceTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'turn_trace'",
      )
      .get();
    const publicPackTable = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pack_content'",
      )
      .get();

    expect(traceTable).toEqual({ name: 'turn_trace' });
    expect(publicPackTable).toBeUndefined();

    db.close();
  });
});
