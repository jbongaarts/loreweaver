import { parseToolCalls } from '../orchestrator/protocol.js';
import type {
  ModelClient,
  ModelCompleteInput,
  ModelMessage,
} from './client.js';
import type { ModelProfileName } from './profiles.js';

export const EVALUATION_DIMENSIONS = [
  'continuity',
  'canonPreservation',
  'npcConsistency',
  'rulesAdjudication',
  'structuredOutputReliability',
  'memoryUpdateQuality',
  'toolUseReliability',
] as const;

export type EvaluationDimension = (typeof EVALUATION_DIMENSIONS)[number];

export type EvaluationScores = Record<EvaluationDimension, number>;

export interface EvaluationTurn {
  playerInput: string;
}

export interface EvaluationScenario {
  id: string;
  name: string;
  turns: EvaluationTurn[];
  expected: Partial<Record<EvaluationDimension, string[]>>;
}

export interface EvaluationTurnRecord {
  scenarioId: string;
  turnIndex: number;
  input: ModelCompleteInput;
  output: string;
  latencyMs: number;
  costUsd: number;
}

export interface EvaluationScenarioReport {
  id: string;
  name: string;
  scores: EvaluationScores;
  turns: EvaluationTurnRecord[];
  transcript: ModelMessage[];
}

export interface PremiumDmEvaluationThreshold {
  minAverageScore: number;
  minDimensionScore: number;
  maxCostUsdPerTurn: number;
  maxAverageLatencyMs: number;
}

export const PREMIUM_DM_EVALUATION_THRESHOLD: PremiumDmEvaluationThreshold = {
  minAverageScore: 0.85,
  minDimensionScore: 0.8,
  maxCostUsdPerTurn: 1,
  maxAverageLatencyMs: 60_000,
};

export interface EvaluationCostInput {
  profile: ModelProfileName;
  scenario: EvaluationScenario;
  turn: EvaluationTurn;
  output: string;
  latencyMs: number;
  turnIndex: number;
}

export interface EvaluateModelProfileInput {
  profile: ModelProfileName;
  model: ModelClient;
  scenarios: EvaluationScenario[];
  costEstimator?: (input: EvaluationCostInput) => number;
  now?: () => number;
}

export interface EvaluationCostReport {
  totalUsd: number;
  perTurnUsd: number;
  /** Scenario-level cost; each scripted scenario represents an eval session. */
  perSessionUsd: number;
}

export interface EvaluationLatencyReport {
  totalMs: number;
  averagePerTurnMs: number;
  perTurnMs: number[];
}

export interface EvaluationReport {
  profile: ModelProfileName;
  scenarios: EvaluationScenarioReport[];
  aggregate: { scores: EvaluationScores; averageScore: number };
  cost: EvaluationCostReport;
  latency: EvaluationLatencyReport;
  threshold: PremiumDmEvaluationThreshold | undefined;
  passed: boolean;
}

const zeroScores = (): EvaluationScores =>
  Object.fromEntries(
    EVALUATION_DIMENSIONS.map((dimension) => [dimension, 0]),
  ) as EvaluationScores;

const clampScore = (score: number): number => Math.max(0, Math.min(1, score));

function scoreNeedles(
  text: string,
  needles: readonly string[] | undefined,
): number {
  if (needles === undefined || needles.length === 0) {
    return 0;
  }
  const normalized = text.toLowerCase();
  const matches = needles.filter((needle) =>
    normalized.includes(needle.toLowerCase()),
  ).length;
  return clampScore(matches / needles.length);
}

function hasJsonObject(text: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
      continue;
    }
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      // Keep scanning for another structured object in the response.
    }
  }
  return false;
}

function scoreToolUse(
  text: string,
  expectedTools: readonly string[] | undefined,
): number {
  if (expectedTools === undefined || expectedTools.length === 0) {
    return 0;
  }
  const calls = parseToolCalls(text)
    .filter((call) => call.ok)
    .map((call) => (call.ok ? call.tool : ''));
  const matches = expectedTools.filter((tool) => calls.includes(tool)).length;
  return clampScore(matches / expectedTools.length);
}

function scoreScenario(
  scenario: EvaluationScenario,
  transcript: readonly ModelMessage[],
): EvaluationScores {
  const text = transcript.map((message) => message.content).join('\n');
  const scores = zeroScores();

  for (const dimension of EVALUATION_DIMENSIONS) {
    if (dimension === 'toolUseReliability') {
      scores[dimension] = scoreToolUse(text, scenario.expected[dimension]);
    } else if (dimension === 'structuredOutputReliability') {
      const expectedScore = scoreNeedles(text, scenario.expected[dimension]);
      scores[dimension] = hasJsonObject(text) ? expectedScore : 0;
    } else {
      scores[dimension] = scoreNeedles(text, scenario.expected[dimension]);
    }
  }

  return scores;
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function aggregateScores(
  reports: readonly EvaluationScenarioReport[],
): EvaluationScores {
  const aggregate = zeroScores();
  for (const dimension of EVALUATION_DIMENSIONS) {
    aggregate[dimension] = average(
      reports.map((report) => report.scores[dimension]),
    );
  }
  return aggregate;
}

function passesPremiumThreshold(
  scores: EvaluationScores,
  cost: EvaluationCostReport,
  latency: EvaluationLatencyReport,
): boolean {
  const values = EVALUATION_DIMENSIONS.map((dimension) => scores[dimension]);
  return (
    average(values) >= PREMIUM_DM_EVALUATION_THRESHOLD.minAverageScore &&
    values.every(
      (score) => score >= PREMIUM_DM_EVALUATION_THRESHOLD.minDimensionScore,
    ) &&
    cost.perTurnUsd <= PREMIUM_DM_EVALUATION_THRESHOLD.maxCostUsdPerTurn &&
    latency.averagePerTurnMs <=
      PREMIUM_DM_EVALUATION_THRESHOLD.maxAverageLatencyMs
  );
}

export async function evaluateModelProfile(
  input: EvaluateModelProfileInput,
): Promise<EvaluationReport> {
  const now = input.now ?? (() => Date.now());
  const scenarios: EvaluationScenarioReport[] = [];
  const allTurns: EvaluationTurnRecord[] = [];

  for (const scenario of input.scenarios) {
    const transcript: ModelMessage[] = [];
    const turnRecords: EvaluationTurnRecord[] = [];

    for (const [turnIndex, turn] of scenario.turns.entries()) {
      transcript.push({ role: 'user', content: turn.playerInput });
      const modelInput: ModelCompleteInput = {
        system:
          `Loreweaver model evaluation harness for profile ${input.profile}. ` +
          `Scenario: ${scenario.name}.`,
        messages: [...transcript],
      };
      const startedAt = now();
      const result = await input.model.complete(modelInput);
      const output = result.text;
      const latencyMs = now() - startedAt;
      const costUsd =
        input.costEstimator?.({
          profile: input.profile,
          scenario,
          turn,
          output,
          latencyMs,
          turnIndex,
        }) ?? 0;

      const record: EvaluationTurnRecord = {
        scenarioId: scenario.id,
        turnIndex,
        input: modelInput,
        output,
        latencyMs,
        costUsd,
      };
      transcript.push({ role: 'assistant', content: output });
      turnRecords.push(record);
      allTurns.push(record);
    }

    scenarios.push({
      id: scenario.id,
      name: scenario.name,
      scores: scoreScenario(scenario, transcript),
      turns: turnRecords,
      transcript,
    });
  }

  const scores = aggregateScores(scenarios);
  const allScoreValues = EVALUATION_DIMENSIONS.map(
    (dimension) => scores[dimension],
  );
  const totalUsd = allTurns.reduce((sum, turn) => sum + turn.costUsd, 0);
  const perTurnMs = allTurns.map((turn) => turn.latencyMs);
  const cost = {
    totalUsd,
    perTurnUsd: average(allTurns.map((turn) => turn.costUsd)),
    perSessionUsd:
      input.scenarios.length === 0 ? 0 : totalUsd / input.scenarios.length,
  };
  const latency = {
    totalMs: perTurnMs.reduce((sum, value) => sum + value, 0),
    averagePerTurnMs: average(perTurnMs),
    perTurnMs,
  };
  const threshold =
    input.profile === 'premium_dm'
      ? PREMIUM_DM_EVALUATION_THRESHOLD
      : undefined;

  return {
    profile: input.profile,
    scenarios,
    aggregate: { scores, averageScore: average(allScoreValues) },
    cost,
    latency,
    threshold,
    passed:
      threshold === undefined
        ? true
        : passesPremiumThreshold(scores, cost, latency),
  };
}
