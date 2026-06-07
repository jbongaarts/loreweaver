import { describe, expect, it } from 'vitest';
import { parseClassCallouts } from '../../../scripts/importers/dnd5e-srd-5.1/parseClassCallouts.js';
import type { PageText } from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

function tieredPage(
  pageNumber: number,
  entries: readonly (readonly [line: string, height: number])[],
): PageText {
  return {
    pageNumber,
    lines: entries.map(([line]) => line),
    lineHeights: entries.map(([, height]) => height),
  };
}

const CLASS_CALLOUT_PAGES: readonly PageText[] = [
  tieredPage(66, [
    ['Druid', 25.92],
    ['Wild Shape', 12],
    ['You can use your action to magically assume the shape of a beast.', 9.84],
    ['Sacred Plants and Wood', 10.8],
    ['A druid holds certain plants to be sacred, particularly alder,', 8.88],
    [
      'ash, birch, elder, hazel, holly, juniper, mistletoe, oak, and willow.',
      8.88,
    ],
    ['Druids and the Gods', 10.8],
    [
      'Some druids venerate the forces of nature themselves, but most druids',
      9.84,
    ],
    [
      'are devoted to one of the many nature deities worshiped in the multiverse.',
      9.84,
    ],
    ['Fighter', 25.92],
    ['Fighting Style', 12],
    ['You adopt a particular style of fighting as your specialty.', 9.84],
  ]),
  tieredPage(86, [
    ['Paladin', 25.92],
    ['Breaking Your Oath', 10.8],
    ['A paladin tries to hold to the highest standards of conduct,', 9.84],
    ['but even the most virtuous paladin is fallible.', 8.88],
    ['Ranger', 25.92],
    ['Favored Enemy', 12],
    ['You have significant experience studying your chosen enemies.', 9.84],
  ]),
  tieredPage(111, [
    ['Warlock', 25.92],
    ['Your Pact Boon', 10.8],
    ['Each Pact Boon option produces a special creature or an object', 9.84],
    ['that reflects the nature of your patron.', 8.88],
    ['Wizard', 25.92],
  ]),
  tieredPage(116, [
    ['Wizard', 25.92],
    ['Your Spellbook', 10.8],
    [
      'The spells that you add to your spellbook as you gain levels reflect',
      9.84,
    ],
    ['the arcane research you conduct on your own.', 8.88],
    ['Copying a Spell into the Book.', 9.84],
    ['When you find a wizard spell, you can add it to your spellbook.', 8.88],
    ['Arcane Tradition', 12],
    ['Choose an arcane tradition that shapes your practice of magic.', 9.84],
  ]),
];

describe('parseClassCallouts', () => {
  const callouts = parseClassCallouts(CLASS_CALLOUT_PAGES);

  it('extracts and class-qualifies every callout in deterministic name order', () => {
    expect(callouts.map(({ name, keySlug }) => [name, keySlug])).toEqual([
      ['Breaking Your Oath', 'paladin-breaking-your-oath'],
      ['Druids and the Gods', 'druid-druids-and-the-gods'],
      ['Sacred Plants and Wood', 'druid-sacred-plants-and-wood'],
      ['Your Pact Boon', 'warlock-your-pact-boon'],
      ['Your Spellbook', 'wizard-your-spellbook'],
    ]);
  });

  it('records the source page of each callout heading', () => {
    expect(
      Object.fromEntries(
        callouts.map(({ name, sourcePage }) => [name, sourcePage]),
      ),
    ).toEqual({
      'Breaking Your Oath': 86,
      'Druids and the Gods': 66,
      'Sacred Plants and Wood': 66,
      'Your Pact Boon': 111,
      'Your Spellbook': 116,
    });
  });

  it('keeps each callout body isolated from the next callout or heading', () => {
    const byName = new Map(
      callouts.map((callout) => [callout.name, callout.text]),
    );

    expect(byName.get('Sacred Plants and Wood')).toContain(
      'A druid holds certain plants to be sacred',
    );
    expect(byName.get('Sacred Plants and Wood')).not.toContain(
      'Druids and the Gods',
    );

    expect(byName.get('Druids and the Gods')).toContain(
      'venerate the forces of nature',
    );
    expect(byName.get('Druids and the Gods')).not.toContain('Fighter');
    expect(byName.get('Druids and the Gods')).not.toContain('Fighting Style');

    expect(byName.get('Breaking Your Oath')).toContain(
      'highest standards of conduct',
    );
    expect(byName.get('Breaking Your Oath')).not.toContain('Ranger');
    expect(byName.get('Breaking Your Oath')).not.toContain('Favored Enemy');

    expect(byName.get('Your Pact Boon')).toContain(
      'reflects the nature of your patron',
    );
    expect(byName.get('Your Pact Boon')).not.toContain('Wizard');

    expect(byName.get('Your Spellbook')).toContain(
      'Copying a Spell into the Book.',
    );
    expect(byName.get('Your Spellbook')).not.toContain('Arcane Tradition');
  });

  it('emits no callouts without genuine heading tiers', () => {
    const noHeights: PageText = {
      pageNumber: 116,
      lines: ['Wizard', 'Your Spellbook', 'Fixture body text.'],
    };
    const uniformHeight: PageText = {
      pageNumber: 116,
      lines: ['Wizard', 'Your Spellbook', 'Fixture body text.'],
      lineHeights: [10.8, 10.8, 10.8],
    };

    expect(parseClassCallouts([noHeights])).toEqual([]);
    expect(parseClassCallouts([uniformHeight])).toEqual([]);
  });
});
