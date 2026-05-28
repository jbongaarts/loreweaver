/**
 * Condition-parser unit tests for the D&D 5e SRD 5.1 importer.
 *
 * Condition text excerpts in this file are reproduced from the System
 * Reference Document 5.1 by Wizards of the Coast LLC, available under the
 * Creative Commons Attribution 4.0 International License (CC-BY-4.0).
 * Excerpts are used as parser test input; no modification has been made
 * beyond reformatting to match the importer's extracted-line input shape.
 */

import { describe, expect, it } from 'vitest';
import { parseConditions } from '../../../scripts/importers/dnd5e-srd-5.1/parseConditions.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

// ---------------------------------------------------------------------------
// Flat-effect condition: Blinded (two bullet-point effects, no prose).
// ---------------------------------------------------------------------------

const BLINDED_PAGE = page(358, [
  'Blinded',
  "• A blinded creature can't see and automatically fails any ability check",
  '  that requires sight.',
  "• Attack rolls against the creature have advantage, and the creature's",
  '  attack rolls have disadvantage.',
]);

describe('parseConditions — flat-effect condition (Blinded)', () => {
  const [blinded] = parseConditions([BLINDED_PAGE]);

  it('extracts the condition name', () => {
    expect(blinded.name).toBe('Blinded');
  });

  it('captures the bullet-point effects with markers stripped', () => {
    expect(blinded.effects).toHaveLength(2);
    expect(blinded.effects[0]).toMatch(/^A blinded creature can't see/);
    expect(blinded.effects[1]).toMatch(/^Attack rolls against the creature/);
  });

  it('builds a non-empty description', () => {
    expect(blinded.description.length).toBeGreaterThan(0);
    expect(typeof blinded.description).toBe('string');
  });

  it('leaves levels undefined for a flat condition', () => {
    expect(blinded.levels).toBeUndefined();
  });

  it('records the source page', () => {
    expect(blinded.sourcePage).toBe(358);
  });
});

// ---------------------------------------------------------------------------
// Condition with multi-part conditional effects: Unconscious.
// SRD 5.1 verbatim: five bullet-point effects including auto-fail saves and
// advantage on attacks.
// ---------------------------------------------------------------------------

const UNCONSCIOUS_PAGE = page(360, [
  'Unconscious',
  "• An unconscious creature is incapacitated, can't move or speak, and is",
  '  unaware of its surroundings.',
  "• The creature drops whatever it's holding and falls prone.",
  '• The creature automatically fails Strength and Dexterity saving throws.',
  '• Attack rolls against the creature have advantage.',
  '• Any attack that hits the creature is a critical hit if the attacker is',
  '  within 5 feet of the creature.',
]);

describe('parseConditions — conditional-effects condition (Unconscious)', () => {
  const [unconscious] = parseConditions([UNCONSCIOUS_PAGE]);

  it('extracts the condition name', () => {
    expect(unconscious.name).toBe('Unconscious');
  });

  it('captures all five effects', () => {
    expect(unconscious.effects).toHaveLength(5);
  });

  it('captures the auto-fail saving-throw effect', () => {
    const saveEffect = unconscious.effects.find((e) =>
      /Strength and Dexterity saving throws/.test(e),
    );
    expect(saveEffect).toBeDefined();
  });

  it('captures the attack-advantage effect', () => {
    const advEffect = unconscious.effects.find((e) =>
      /attack rolls against the creature have advantage/i.test(e),
    );
    expect(advEffect).toBeDefined();
  });

  it('captures the critical-hit-within-5-feet effect', () => {
    const critEffect = unconscious.effects.find((e) =>
      /critical hit if the attacker is/.test(e),
    );
    expect(critEffect).toBeDefined();
  });

  it('leaves levels undefined', () => {
    expect(unconscious.levels).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Level-bearing condition: Exhaustion (introductory prose + 6-level table).
// ---------------------------------------------------------------------------

const EXHAUSTION_PAGE = page(359, [
  'Exhaustion',
  'Some special abilities and environmental hazards, such as starvation and',
  'the long-term effects of freezing or scorching temperatures, can lead to a',
  'special condition called exhaustion. Exhaustion is measured in six levels.',
  'An effect can give a creature one or more levels of exhaustion, as',
  "specified in the effect's description.",
  '',
  'Level Effect',
  '1 Disadvantage on ability checks',
  '2 Speed halved',
  '3 Disadvantage on attack rolls and saving throws',
  '4 Hit point maximum halved',
  '5 Speed reduced to 0',
  '6 Death',
  '',
  'If an already exhausted creature suffers another effect that causes',
  'exhaustion, its current level of exhaustion increases by the amount',
  "specified in the effect's description.",
]);

describe('parseConditions — level-bearing condition (Exhaustion)', () => {
  const [exhaustion] = parseConditions([EXHAUSTION_PAGE]);

  it('extracts the condition name', () => {
    expect(exhaustion.name).toBe('Exhaustion');
  });

  it('extracts all six exhaustion levels', () => {
    expect(exhaustion.levels).toHaveLength(6);
  });

  it('captures level 1 effect', () => {
    expect(exhaustion.levels?.[0]).toEqual({
      level: 1,
      effect: 'Disadvantage on ability checks',
    });
  });

  it('captures level 6 effect (Death)', () => {
    expect(exhaustion.levels?.[5]).toEqual({ level: 6, effect: 'Death' });
  });

  it('captures the introductory prose in the description', () => {
    expect(exhaustion.description).toMatch(
      /Exhaustion is measured in six levels/,
    );
  });

  it('includes the trailing prose about stacking exhaustion', () => {
    expect(exhaustion.description).toMatch(/already exhausted creature/);
  });

  it('does not include the level-header line in description', () => {
    expect(exhaustion.description).not.toMatch(/^Level\s+Effect$/m);
  });
});

// ---------------------------------------------------------------------------
// Two-column PDF extraction artifact: level number and effect on separate lines.
// ---------------------------------------------------------------------------

const EXHAUSTION_SPLIT_TABLE_PAGE = page(359, [
  'Exhaustion',
  'Exhaustion is measured in six levels.',
  '',
  'Level Effect',
  '1',
  'Disadvantage on ability checks',
  '2',
  'Speed halved',
  '3',
  'Disadvantage on attack rolls and saving throws',
  '4',
  'Hit point maximum halved',
  '5',
  'Speed reduced to 0',
  '6',
  'Death',
]);

describe('parseConditions — exhaustion with split-column PDF table', () => {
  const [exhaustion] = parseConditions([EXHAUSTION_SPLIT_TABLE_PAGE]);

  it('merges split-column rows into six levels', () => {
    expect(exhaustion.levels).toHaveLength(6);
  });

  it('pairs level 1 with its effect', () => {
    expect(exhaustion.levels?.[0]).toEqual({
      level: 1,
      effect: 'Disadvantage on ability checks',
    });
  });

  it('pairs level 6 with Death', () => {
    expect(exhaustion.levels?.[5]).toEqual({ level: 6, effect: 'Death' });
  });
});

// ---------------------------------------------------------------------------
// Multiple conditions on one page: output must be sorted by name.
// ---------------------------------------------------------------------------

describe('parseConditions — multiple conditions, sorted output', () => {
  const multiPage = page(358, [
    'Unconscious',
    '• An unconscious creature is incapacitated.',
    '',
    'Blinded',
    "• A blinded creature can't see.",
    '',
    'Charmed',
    "• A charmed creature can't attack the charmer.",
  ]);

  it('returns all three conditions', () => {
    const results = parseConditions([multiPage]);
    expect(results).toHaveLength(3);
  });

  it('returns conditions sorted by name', () => {
    const results = parseConditions([multiPage]);
    const names = results.map((c) => c.name);
    expect(names).toEqual([...names].sort());
  });

  it('does not bleed one condition body into another', () => {
    const results = parseConditions([multiPage]);
    const blinded = results.find((c) => c.name === 'Blinded');
    const charmed = results.find((c) => c.name === 'Charmed');
    expect(blinded?.effects[0]).toMatch(/^A blinded creature/);
    expect(charmed?.effects[0]).toMatch(/^A charmed creature/);
    expect(blinded?.description).not.toMatch(/charmer/);
  });
});

// ---------------------------------------------------------------------------
// Conditions spanning multiple pages.
// ---------------------------------------------------------------------------

describe('parseConditions — conditions spanning multiple pages', () => {
  it('picks up conditions from each page independently', () => {
    const p1 = page(358, ['Blinded', "• A blinded creature can't see."]);
    const p2 = page(359, [
      'Charmed',
      "• A charmed creature can't attack the charmer.",
    ]);
    const results = parseConditions([p1, p2]);
    expect(results).toHaveLength(2);
    const blinded = results.find((c) => c.name === 'Blinded');
    expect(blinded?.sourcePage).toBe(358);
    const charmed = results.find((c) => c.name === 'Charmed');
    expect(charmed?.sourcePage).toBe(359);
  });
});

// ---------------------------------------------------------------------------
// Empty input: should return an empty array without throwing.
// ---------------------------------------------------------------------------

describe('parseConditions — empty input', () => {
  it('returns an empty array for an empty page list', () => {
    expect(parseConditions([])).toEqual([]);
  });

  it('returns an empty array when no condition names are found', () => {
    const p = page(1, ['This is not a condition.', 'Some other text.']);
    expect(parseConditions([p])).toEqual([]);
  });
});
