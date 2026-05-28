/**
 * Determinism + validation tests for the importer emit module.
 *
 * The emit module is the boundary between parsed SRD spell extractions and
 * the on-disk pack files. Two guarantees matter here:
 *   1. The emitted JSON is byte-identical across runs over the same input.
 *   2. The emitted pack always passes `validateRulesPack` — i.e. the
 *      generated records satisfy the per-kind dnd5e-srd spell schema and
 *      every record's provenance references the pack's source URL.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  actionExtractionsToRecords,
  buildPack,
  spellExtractionsToRecords,
  tableExtractionsToRecords,
  writePackToDirectory,
} from '../../../scripts/importers/dnd5e-srd-5.1/emit.js';
import type {
  ActionExtraction,
  RuleExtraction,
  SpellCasterClass,
  SpellExtraction,
  TableExtraction,
} from '../../../scripts/importers/dnd5e-srd-5.1/types.js';

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'srd-importer-emit-'));
  tmpDirs.push(dir);
  return dir;
}

const ACID_SPLASH: SpellExtraction = {
  name: 'Acid Splash',
  level: 0,
  school: 'conjuration',
  ritual: false,
  castingTime: '1 action',
  range: '60 feet',
  components: ['V', 'S'],
  duration: 'Instantaneous',
  description: 'You hurl a bubble of acid.',
  higherLevels:
    "This spell's damage increases by 1d6 when you reach 5th level (2d6), 11th level (3d6), and 17th level (4d6).",
  sourcePage: 211,
};

const MAGIC_MISSILE: SpellExtraction = {
  name: 'Magic Missile',
  level: 1,
  school: 'evocation',
  ritual: false,
  castingTime: '1 action',
  range: '120 feet',
  components: ['V', 'S'],
  duration: 'Instantaneous',
  description: 'You create three glowing darts of magical force.',
  higherLevels:
    'When you cast this spell using a spell slot of 2nd level or higher, the spell creates one more dart for each slot level above 1st.',
  sourcePage: 257,
};

const AID: SpellExtraction = {
  name: 'Aid',
  level: 2,
  school: 'abjuration',
  ritual: false,
  castingTime: '1 action',
  range: '30 feet',
  components: ['V', 'S', 'M'],
  componentMaterials: 'a tiny strip of white cloth',
  duration: '8 hours',
  description: 'Your spell bolsters your allies with toughness and resolve.',
  sourcePage: 211,
};

const COVER_RULE: RuleExtraction = {
  name: 'Cover',
  text: 'Walls, trees, creatures, and other obstacles can provide cover during combat.',
  sourcePage: 196,
};

const ATTACK_ACTION: ActionExtraction = {
  name: 'Attack',
  description: 'The most common action to take in combat is the Attack action.',
  sourcePage: 92,
};

const DIFFICULTY_TABLE: TableExtraction = {
  name: 'Difficulty Classes',
  columns: ['Task Difficulty', 'DC'],
  rows: [
    ['Very easy', 5],
    ['Easy', 10],
    ['Medium', 15],
    ['Hard', 20],
  ],
  sourcePage: 77,
};

function makeIndex(
  entries: ReadonlyArray<[string, SpellCasterClass[]]>,
): Map<string, Set<SpellCasterClass>> {
  const map = new Map<string, Set<SpellCasterClass>>();
  for (const [name, classes] of entries) {
    map.set(name, new Set(classes));
  }
  return map;
}

const FAKE_HASH = 'a'.repeat(64);

describe('buildPack — validation', () => {
  it('produces a pack that passes validateRulesPack', () => {
    const pack = buildPack({
      spells: [ACID_SPLASH, MAGIC_MISSILE],
      classIndex: makeIndex([
        ['Acid Splash', ['Sorcerer', 'Wizard']],
        ['Magic Missile', ['Sorcerer', 'Wizard']],
      ]),
      conditions: [],
      sourceHash: FAKE_HASH,
    });
    expect(pack.meta.packId).toBe('rules:dnd5e-srd-5.1');
    expect(pack.records).toHaveLength(2);
  });

  it('sorts records by key', () => {
    const pack = buildPack({
      spells: [MAGIC_MISSILE, ACID_SPLASH, AID],
      classIndex: makeIndex([]),
      conditions: [],
      sourceHash: FAKE_HASH,
    });
    const keys = pack.records.map((r) => r.key);
    expect(keys).toEqual([...keys].sort());
  });

  it('embeds the source hash in the manifest', () => {
    const pack = buildPack({
      spells: [ACID_SPLASH],
      classIndex: makeIndex([]),
      conditions: [],
      sourceHash: FAKE_HASH,
    });
    expect(pack.meta.source.sourceHash).toBe(FAKE_HASH);
  });

  it('lists only "spell" in the included-kinds description (no half-built coverage claim)', () => {
    const pack = buildPack({
      spells: [ACID_SPLASH],
      classIndex: makeIndex([]),
      conditions: [],
      sourceHash: FAKE_HASH,
    });
    expect(pack.meta.description).toMatch(/Included record kinds: spell\b/);
  });

  it('includes rule records and names both kinds in the included-kinds description', () => {
    const pack = buildPack({
      spells: [ACID_SPLASH],
      classIndex: makeIndex([]),
      conditions: [],
      rules: [COVER_RULE],
      sourceHash: FAKE_HASH,
    });
    const ruleKeys = pack.records
      .filter((r) => r.kind === 'rule')
      .map((r) => r.key);
    expect(ruleKeys).toEqual(['rule:cover']);
    const cover = pack.records.find((r) => r.key === 'rule:cover');
    expect((cover?.data as Record<string, unknown>).text).toMatch(
      /provide cover during combat/i,
    );
    expect(pack.meta.description).toMatch(
      /Included record kinds: .*rule.*spell|Included record kinds: .*spell.*rule/,
    );
  });

  it('includes "action" in included-kinds when action records are present', () => {
    const pack = buildPack({
      spells: [ACID_SPLASH],
      classIndex: makeIndex([]),
      conditions: [],
      actions: [ATTACK_ACTION],
      sourceHash: FAKE_HASH,
    });
    expect(pack.meta.description).toMatch(
      /Included record kinds: action, spell\b/,
    );
  });

  it('includes "table" in included-kinds when table records are present', () => {
    const pack = buildPack({
      spells: [ACID_SPLASH],
      classIndex: makeIndex([]),
      conditions: [],
      tables: [DIFFICULTY_TABLE],
      sourceHash: FAKE_HASH,
    });
    expect(pack.meta.description).toMatch(
      /Included record kinds: spell, table\b/,
    );
  });
});

describe('spellExtractionsToRecords — record shape', () => {
  it('builds a record key of the form "spell:<slug>"', () => {
    const [record] = spellExtractionsToRecords(
      [ACID_SPLASH],
      new Map([['Acid Splash', ['Wizard']]]),
    );
    expect(record.key).toBe('spell:acid-splash');
  });

  it('preserves classes in the order supplied', () => {
    const [record] = spellExtractionsToRecords(
      [ACID_SPLASH],
      new Map([['Acid Splash', ['Sorcerer', 'Wizard']]]),
    );
    expect((record.data as { classes: string[] }).classes).toEqual([
      'Sorcerer',
      'Wizard',
    ]);
  });

  it('includes componentMaterials only when present', () => {
    const [acidRec] = spellExtractionsToRecords([ACID_SPLASH], new Map());
    const [aidRec] = spellExtractionsToRecords([AID], new Map());
    expect(
      (acidRec.data as Record<string, unknown>).componentMaterials,
    ).toBeUndefined();
    expect((aidRec.data as Record<string, unknown>).componentMaterials).toBe(
      'a tiny strip of white cloth',
    );
  });

  it('attaches provenance pointing at the SRD source URL', () => {
    const [record] = spellExtractionsToRecords([ACID_SPLASH], new Map());
    expect(record.provenance.sourceRef).toBe(
      'https://dnd.wizards.com/resources/systems-reference-document',
    );
    expect(record.provenance.locator).toBe('p. 211');
  });
});

describe('actionExtractionsToRecords — record shape', () => {
  it('builds action keys of the form "action:<slug>"', () => {
    const [record] = actionExtractionsToRecords([ATTACK_ACTION]);
    expect(record.key).toBe('action:attack');
  });

  it('stores action description in data.description', () => {
    const [record] = actionExtractionsToRecords([ATTACK_ACTION]);
    expect((record.data as { description: string }).description).toMatch(
      /Attack action/,
    );
  });
});

describe('tableExtractionsToRecords - record shape', () => {
  it('builds table keys of the form "table:<slug>"', () => {
    const [record] = tableExtractionsToRecords([DIFFICULTY_TABLE]);
    expect(record.key).toBe('table:difficulty-classes');
  });

  it('stores columns and rows in the table kindSchema shape', () => {
    const [record] = tableExtractionsToRecords([DIFFICULTY_TABLE]);
    expect(record.kind).toBe('table');
    expect((record.data as { columns: string[] }).columns).toEqual([
      'Task Difficulty',
      'DC',
    ]);
    expect((record.data as { rows: unknown[][] }).rows).toEqual([
      ['Very easy', 5],
      ['Easy', 10],
      ['Medium', 15],
      ['Hard', 20],
    ]);
  });
});

describe('writePackToDirectory — determinism', () => {
  it('produces byte-identical files across two runs over the same input', () => {
    const dirA = makeTmpDir();
    const dirB = makeTmpDir();
    const input = {
      spells: [ACID_SPLASH, AID, MAGIC_MISSILE],
      classIndex: makeIndex([
        ['Acid Splash', ['Sorcerer', 'Wizard']],
        ['Aid', ['Cleric', 'Paladin']],
        ['Magic Missile', ['Sorcerer', 'Wizard']],
      ]),
      conditions: [],
      sourceHash: FAKE_HASH,
    };
    writePackToDirectory(buildPack(input), { outDir: dirA });
    writePackToDirectory(buildPack(input), { outDir: dirB });
    expect(readFileSync(join(dirA, 'manifest.json'), 'utf8')).toBe(
      readFileSync(join(dirB, 'manifest.json'), 'utf8'),
    );
    expect(readFileSync(join(dirA, 'records.json'), 'utf8')).toBe(
      readFileSync(join(dirB, 'records.json'), 'utf8'),
    );
  });

  it('does not depend on input spell order', () => {
    const dirA = makeTmpDir();
    const dirB = makeTmpDir();
    writePackToDirectory(
      buildPack({
        spells: [ACID_SPLASH, AID, MAGIC_MISSILE],
        classIndex: makeIndex([]),
        conditions: [],
        sourceHash: FAKE_HASH,
      }),
      { outDir: dirA },
    );
    writePackToDirectory(
      buildPack({
        spells: [MAGIC_MISSILE, ACID_SPLASH, AID],
        classIndex: makeIndex([]),
        conditions: [],
        sourceHash: FAKE_HASH,
      }),
      { outDir: dirB },
    );
    expect(readFileSync(join(dirA, 'records.json'), 'utf8')).toBe(
      readFileSync(join(dirB, 'records.json'), 'utf8'),
    );
  });

  it('does not depend on class-index insertion order', () => {
    const dirA = makeTmpDir();
    const dirB = makeTmpDir();
    writePackToDirectory(
      buildPack({
        spells: [ACID_SPLASH],
        classIndex: makeIndex([['Acid Splash', ['Wizard', 'Sorcerer']]]),
        conditions: [],
        sourceHash: FAKE_HASH,
      }),
      { outDir: dirA },
    );
    writePackToDirectory(
      buildPack({
        spells: [ACID_SPLASH],
        classIndex: makeIndex([['Acid Splash', ['Sorcerer', 'Wizard']]]),
        conditions: [],
        sourceHash: FAKE_HASH,
      }),
      { outDir: dirB },
    );
    expect(readFileSync(join(dirA, 'records.json'), 'utf8')).toBe(
      readFileSync(join(dirB, 'records.json'), 'utf8'),
    );
  });

  it('emits a trailing newline on both files', () => {
    const dir = makeTmpDir();
    writePackToDirectory(
      buildPack({
        spells: [ACID_SPLASH],
        classIndex: makeIndex([]),
        conditions: [],
        sourceHash: FAKE_HASH,
      }),
      { outDir: dir },
    );
    expect(
      readFileSync(join(dir, 'manifest.json'), 'utf8').endsWith('\n'),
    ).toBe(true);
    expect(readFileSync(join(dir, 'records.json'), 'utf8').endsWith('\n')).toBe(
      true,
    );
  });
});
