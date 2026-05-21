import { describe, expect, it } from 'vitest';
import {
  evaluateModelProfile,
  PREMIUM_DM_EVALUATION_THRESHOLD,
} from '../src/index.js';
import type {
  EvaluationDimension,
  EvaluationScenario,
  ModelClient,
  ModelCompleteInput,
} from '../src/index.js';

class ScriptedModel implements ModelClient {
  private index = 0;
  readonly seen: ModelCompleteInput[] = [];

  constructor(private readonly replies: string[]) {}

  complete(input: ModelCompleteInput): Promise<string> {
    this.seen.push(input);
    const reply = this.replies[this.index] ?? '';
    this.index += 1;
    return Promise.resolve(reply);
  }
}

const DIMENSIONS: EvaluationDimension[] = [
  'continuity',
  'canonPreservation',
  'npcConsistency',
  'rulesAdjudication',
  'structuredOutputReliability',
  'memoryUpdateQuality',
  'toolUseReliability',
];

describe('model evaluation harness', () => {
  it('runs scripted scenarios and records profile quality, cost, and latency', async () => {
    const model = new ScriptedModel([
      [
        'Mira still carries the moonlit key.',
        '{"memoryUpdates":["Mira has the moonlit key"]}',
        '```tool_call',
        '{"tool":"lookup_srd","args":{"kind":"spell","name":"Mage Armor"}}',
        '```',
      ].join('\n'),
    ]);
    let now = 1000;
    const scenario: EvaluationScenario = {
      id: 'continuity-canon-rules',
      name: 'Long campaign continuity and tool use',
      turns: [
        {
          playerInput:
            'Mira uses the moonlit key and asks whether Mage Armor stacks with armor.',
        },
      ],
      expected: {
        continuity: ['moonlit key'],
        canonPreservation: ['Mira'],
        npcConsistency: ['Mira'],
        rulesAdjudication: ['Mage Armor'],
        structuredOutputReliability: ['memoryUpdates'],
        memoryUpdateQuality: ['moonlit key'],
        toolUseReliability: ['lookup_srd'],
      },
    };

    const report = await evaluateModelProfile({
      profile: 'premium_dm',
      model,
      scenarios: [scenario],
      costEstimator: () => 0.02,
      now: () => {
        now += 25;
        return now;
      },
    });

    expect(model.seen).toHaveLength(1);
    expect(model.seen[0].system).toContain('premium_dm');
    expect(report.profile).toBe('premium_dm');
    expect(report.threshold).toEqual(PREMIUM_DM_EVALUATION_THRESHOLD);
    expect(report.passed).toBe(true);
    expect(report.scenarios[0].scores).toEqual(
      Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, 1])),
    );
    expect(report.aggregate.scores).toEqual(
      Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, 1])),
    );
    expect(report.cost).toEqual({
      totalUsd: 0.02,
      perTurnUsd: 0.02,
      perSessionUsd: 0.02,
    });
    expect(report.latency).toEqual({
      totalMs: 25,
      averagePerTurnMs: 25,
      perTurnMs: [25],
    });
  });
});
