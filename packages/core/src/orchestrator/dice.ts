import type { Rng } from './rng.js';

/**
 * Dice-notation parsing and resolution (E5). The `roll` tool delegates here so
 * all math is code-owned and deterministic under a seeded RNG.
 */

export class DiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiceError';
  }
}

export interface DiceNotation {
  count: number;
  faces: number;
  modifier: number;
}

export interface DiceRoll {
  notation: string;
  count: number;
  faces: number;
  rolls: number[];
  modifier: number;
  total: number;
}

const DICE_RE = /^(\d*)d(\d+)(?:([+-])(\d+))?$/i;
const MAX_COUNT = 100;
const MAX_FACES = 1000;
const MAX_NOTATION_LEN = 32;

export function parseDice(notation: string): DiceNotation {
  if (notation.length > MAX_NOTATION_LEN) {
    throw new DiceError(`invalid dice notation: '${notation}'`);
  }
  const match = DICE_RE.exec(notation.replace(/\s+/g, ''));
  if (match === null) {
    throw new DiceError(`invalid dice notation: '${notation}'`);
  }
  const count = match[1] === '' ? 1 : Number(match[1]);
  const faces = Number(match[2]);
  const modifier =
    match[3] === undefined
      ? 0
      : match[3] === '-'
        ? -Number(match[4])
        : Number(match[4]);

  if (count < 1 || count > MAX_COUNT) {
    throw new DiceError(`dice count out of range (1-${MAX_COUNT}): ${count}`);
  }
  if (faces < 2 || faces > MAX_FACES) {
    throw new DiceError(`dice faces out of range (2-${MAX_FACES}): ${faces}`);
  }
  return { count, faces, modifier };
}

export function rollDice(notation: string, rng: Rng): DiceRoll {
  const { count, faces, modifier } = parseDice(notation);
  const rolls: number[] = [];
  for (let i = 0; i < count; i += 1) {
    rolls.push(rng.nextInt(faces) + 1);
  }
  const total = rolls.reduce((sum, r) => sum + r, 0) + modifier;
  return { notation, count, faces, rolls, modifier, total };
}
