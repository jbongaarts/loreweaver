/**
 * Rule-parser unit tests for the D&D 5e SRD 5.1 importer.
 *
 * Rule text excerpts in this file are reproduced from the System Reference
 * Document 5.1 by Wizards of the Coast LLC, available under the Creative
 * Commons Attribution 4.0 International License (CC-BY-4.0). Excerpts are
 * used as parser test input; no modification has been made beyond reformatting
 * to match the importer's extracted-line input shape.
 */

import { describe, expect, it } from 'vitest';
import { parseRules } from '../../../scripts/importers/dnd5e-srd-5.1/parseRules.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function page(pageNumber: number, lines: string[]): PageText {
  return { pageNumber, lines };
}

const COVER_AND_RESTING = page(77, [
  'Cover',
  'Walls, trees, creatures, and other obstacles can provide cover during combat,',
  'making a target more difficult to harm.',
  '',
  'A target with half cover has a +2 bonus to AC and Dexterity saving throws.',
  '',
  'Resting',
  'Adventurers can take short rests and long rests to recover from wounds,',
  'regain class resources, and prepare for the next challenge.',
  '',
  'A short rest is at least 1 hour long, and a long rest is at least 8 hours.',
]);

const ADVANTAGE_AND_UNDERWATER = page(78, [
  'Advantage and Disadvantage',
  'Sometimes a special ability or spell tells you that you have advantage or',
  'disadvantage on an ability check, a saving throw, or an attack roll.',
  '',
  'When that happens, you roll a second d20 when you make the roll.',
  '',
  'Underwater Combat',
  'When making a melee weapon attack, a creature that does not have a swimming',
  'speed has disadvantage on the attack roll unless the weapon is a dagger,',
  'javelin, shortsword, spear, or trident.',
]);

const NON_BOUNDARY_TITLE_CASE = page(79, [
  'Cover',
  'Walls and trees can provide cover during combat.',
  'This paragraph includes Special Cases',
  'that are still prose and not a new section heading.',
  '',
  'Resting',
  'A short rest is at least 1 hour long.',
]);

const DIFFICULTY_CLASSES_TABLE = page(80, [
  'Difficulty Classes',
  'Use the Difficulty Classes table when a task has no explicit DC.',
  '',
  'Task Difficulty',
  'DC',
  'Very easy 5',
  'Easy 10',
  'Medium 15',
]);

describe('parseRules', () => {
  it('extracts labeled rules and sorts by name', () => {
    const rules = parseRules([COVER_AND_RESTING, ADVANTAGE_AND_UNDERWATER]);
    expect(rules).toHaveLength(4);
    expect(rules.map((r) => r.name)).toEqual([
      'Advantage and Disadvantage',
      'Cover',
      'Resting',
      'Underwater Combat',
    ]);
  });

  it('captures full body text in data-text source field shape', () => {
    const [cover] = parseRules([COVER_AND_RESTING]).filter(
      (r) => r.name === 'Cover',
    );
    expect(cover.text).toMatch(/provide cover during combat/);
    expect(cover.text).toMatch(/\+2 bonus to AC/);
    expect(cover.text.length).toBeGreaterThan(0);
  });

  it('does not bleed one rule body into the next heading', () => {
    const [cover] = parseRules([COVER_AND_RESTING]).filter(
      (r) => r.name === 'Cover',
    );
    const [resting] = parseRules([COVER_AND_RESTING]).filter(
      (r) => r.name === 'Resting',
    );
    expect(cover.text).not.toMatch(/Resting/);
    expect(resting.text).not.toMatch(/^Cover$/m);
  });

  it('preserves sourcePage where each heading appears', () => {
    const rules = parseRules([COVER_AND_RESTING, ADVANTAGE_AND_UNDERWATER]);
    const cover = rules.find((r) => r.name === 'Cover');
    const underwater = rules.find((r) => r.name === 'Underwater Combat');
    expect(cover?.sourcePage).toBe(77);
    expect(underwater?.sourcePage).toBe(78);
  });

  it('does not promote title-case prose lines that are not at a boundary', () => {
    const rules = parseRules([NON_BOUNDARY_TITLE_CASE]);
    const names = rules.map((r) => r.name);
    expect(names).toEqual(['Cover', 'Resting']);
    expect(names).not.toContain('Special Cases');
  });

  it('does not promote table labels or short headers into rule entries', () => {
    const rules = parseRules([DIFFICULTY_CLASSES_TABLE]);
    const names = rules.map((r) => r.name);
    expect(names).toContain('Difficulty Classes');
    expect(names).not.toContain('Task Difficulty');
    expect(names).not.toContain('DC');
  });

  it('returns an empty array for empty input', () => {
    expect(parseRules([])).toEqual([]);
  });
});

/**
 * Heading-hierarchy path (loreweaver-yli): exercised when the page carries
 * per-line font heights. SRD 5.1 core-rules tiers are subsection h≈18,
 * sub-subsection h≈13.9, and leaf h≈12, over body prose at h≈9.8.
 */
const SUB_H = 18;
const SUBSUB_H = 13.9;
const LEAF_H = 12;
const BOX_H = 10.8;
const BODY_H = 9.8;

function pageH(
  pageNumber: number,
  rows: ReadonlyArray<readonly [string, number]>,
): PageText {
  return {
    pageNumber,
    lines: rows.map((r) => r[0]),
    lineHeights: rows.map((r) => r[1]),
  };
}

describe('parseRules (heading-hierarchy path)', () => {
  it('emits a rule per heading tier without dropping the parent', () => {
    const rules = parseRules([
      pageH(94, [
        ['Making an Attack', SUB_H],
        ['When you take the Attack action, you make an attack.', BODY_H],
        ['Attack Rolls', SUBSUB_H],
        ['To make an attack roll, roll a d20 and add modifiers.', BODY_H],
        ['Modifiers to the Roll', LEAF_H],
        ['Ability modifier and proficiency bonus apply.', BODY_H],
      ]),
    ]);
    expect(rules.map((r) => r.name)).toEqual([
      'Attack Rolls',
      'Making an Attack',
      'Modifiers to the Roll',
    ]);
    // Parent body is bounded at its first child (intro prose only).
    const parent = rules.find((r) => r.name === 'Making an Attack');
    expect(parent?.text).toMatch(/take the Attack action/);
    expect(parent?.text).not.toMatch(/roll a d20/);
    // Leaf keeps its own body and is keyed by its slug.
    const leaf = rules.find((r) => r.name === 'Attack Rolls');
    expect(leaf?.keySlug).toBe('attack-rolls');
    expect(leaf?.text).toMatch(/roll a d20/);
  });

  it('merges a heading that wraps across two rows', () => {
    const rules = parseRules([
      pageH(76, [
        ['Advantage and', SUB_H],
        ['Disadvantage', SUB_H],
        ['Sometimes you roll a second d20.', BODY_H],
      ]),
    ]);
    expect(rules).toHaveLength(1);
    expect(rules[0].name).toBe('Advantage and Disadvantage');
    expect(rules[0].keySlug).toBe('advantage-and-disadvantage');
  });

  it('parent-qualifies colliding leaf keys across chapters', () => {
    const rules = parseRules([
      pageH(81, [
        ['Constitution', SUBSUB_H],
        ['Constitution measures health.', BODY_H],
        ['Hit Points', LEAF_H],
        ['Your Constitution modifier contributes to hit points.', BODY_H],
      ]),
      pageH(96, [
        ['Damage and Healing', SUB_H],
        ['Combat wears down hit points.', BODY_H],
        ['Hit Points', SUBSUB_H],
        ['Hit points represent durability.', BODY_H],
      ]),
    ]);
    const hitPoints = rules.filter((r) => r.name === 'Hit Points');
    expect(hitPoints).toHaveLength(2);
    expect(hitPoints.map((r) => r.keySlug).sort()).toEqual([
      'constitution-hit-points',
      'damage-and-healing-hit-points',
    ]);
  });

  it('excludes Variant rules, bullet-led skill captions, and table captions', () => {
    const rules = parseRules([
      pageH(78, [
        ['Skills', SUBSUB_H],
        ['Each ability covers several skills.', BODY_H],
        ['Strength', LEAF_H],
        ['• Athletics', BODY_H],
        ['Variant: Skills with Different Abilities', LEAF_H],
        ['Normally you use a fixed ability for a skill.', BODY_H],
        ['Typical Difficulty Classes', LEAF_H],
        ['Task Difficulty DC', BODY_H],
        ['Very easy 5', BODY_H],
      ]),
    ]);
    const names = rules.map((r) => r.name);
    expect(names).toContain('Skills');
    expect(names).not.toContain('Strength');
    expect(names).not.toContain('Variant: Skills with Different Abilities');
    expect(names).not.toContain('Typical Difficulty Classes');
  });

  it('captures a sub-leaf callout box and does not bleed it into the prior rule', () => {
    // A gray callout box heading renders at h≈10.8 (below the h≈12 leaf tier).
    // It must still be a heading, or its body is swallowed into the preceding
    // rule — the Hiding-under-Initiative corruption (loreweaver-yli).
    const rules = parseRules([
      pageH(80, [
        ['Initiative', LEAF_H],
        ['At the beginning of every combat, you roll initiative.', BODY_H],
        ['Hiding', BOX_H],
        ['When you try to hide, make a Dexterity (Stealth) check.', BODY_H],
      ]),
    ]);
    expect(rules.map((r) => r.name)).toEqual(['Hiding', 'Initiative']);
    const initiative = rules.find((r) => r.name === 'Initiative');
    expect(initiative?.text).toContain('roll initiative');
    expect(initiative?.text).not.toContain('Dexterity (Stealth)');
    const hiding = rules.find((r) => r.name === 'Hiding');
    expect(hiding?.keySlug).toBe('hiding');
    expect(hiding?.text).toContain('Dexterity (Stealth)');
  });

  it('keeps a same-named subsection while dropping its leaf table caption', () => {
    const rules = parseRules([
      pageH(76, [
        ['Ability Scores and Modifiers', SUB_H],
        ['Each ability has a score.', BODY_H],
        ['Ability Scores and Modifiers', LEAF_H],
        ['Score Modifier', BODY_H],
        ['1 −5', BODY_H],
      ]),
    ]);
    expect(rules).toHaveLength(1);
    expect(rules[0].name).toBe('Ability Scores and Modifiers');
    expect(rules[0].text).toMatch(/Each ability has a score/);
  });
});
