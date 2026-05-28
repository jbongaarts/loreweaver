/**
 * End-to-end pipeline test for the D&D 5e SRD 5.1 importer.
 *
 * Generates a small fixture PDF at test time using pdfkit (so no binary
 * fixture has to live in the repo), runs the full importer (extract → parse
 * → emit), and round-trips through `loadRulesPackFromDirectory` to confirm
 * the produced files load and validate.
 *
 * The fixture PDF mimics the SRD layout closely enough to exercise the
 * spell-stat-block parser and the class-spell-list parser, but is much
 * smaller than the real SRD. The full SRD PDF is the responsibility of
 * `loreweaver-0m9.6`'s coverage tests once vendored.
 */

import { createWriteStream, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { afterEach, describe, expect, it } from 'vitest';
import { runImporter } from '../../../scripts/importers/dnd5e-srd-5.1/index.js';
import { SectionNotFoundError } from '../../../scripts/importers/dnd5e-srd-5.1/sections.js';
import { loadRulesPackFromDirectory } from '../../../src/internal.js';

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'srd-importer-pipeline-'));
  tmpDirs.push(dir);
  return dir;
}

interface FixtureLine {
  readonly text: string;
  /** Optional explicit gap before this line. */
  readonly leadingGap?: number;
}

interface FixturePage {
  readonly lines: ReadonlyArray<string | FixtureLine>;
}

async function writeFixturePdf(
  filePath: string,
  pages: readonly FixturePage[],
): Promise<void> {
  // size: LETTER (612 x 792 pt), small margins so we fit ~50 lines per page.
  const doc = new PDFDocument({
    size: 'LETTER',
    margin: 40,
    autoFirstPage: false,
  });
  const stream = createWriteStream(filePath);
  doc.pipe(stream);
  doc.font('Helvetica').fontSize(11);

  pages.forEach((page, i) => {
    doc.addPage();
    for (const entry of page.lines) {
      if (typeof entry === 'string') {
        doc.text(entry);
      } else {
        if (entry.leadingGap !== undefined && entry.leadingGap > 0) {
          doc.moveDown(entry.leadingGap);
        }
        doc.text(entry.text);
      }
    }
    // Mark page i+1 explicitly (we don't read this; the parser uses
    // PageText.pageNumber from extract.ts, which counts pages in order).
    void i;
  });

  doc.end();
  await new Promise<void>((resolve, reject) => {
    stream.on('finish', () => resolve());
    stream.on('error', reject);
  });
}

// The fixture deliberately mirrors the SRD 5.1 chapter ordering: spell-lists
// chapter precedes spell-descriptions chapter. Default section anchors
// (`SRD_5_1_DEFAULT_SECTION_ANCHORS`) discriminate the two by exact heading
// match.
const SPELL_LISTS_PAGE: FixturePage = {
  lines: [
    'Spell Lists',
    'Wizard Spells',
    'Cantrips (0 Level)',
    'Acid Splash',
    '',
    '1st Level',
    'Magic Missile',
    '',
    'Sorcerer Spells',
    'Cantrips (0 Level)',
    'Acid Splash',
    '',
    '1st Level',
    'Magic Missile',
  ],
};

const SPELLS_PAGE: FixturePage = {
  lines: [
    'Spells',
    'Acid Splash',
    'Conjuration cantrip',
    'Casting Time: 1 action',
    'Range: 60 feet',
    'Components: V, S',
    'Duration: Instantaneous',
    'You hurl a bubble of acid. Choose one creature you can see within range.',
    '',
    'Magic Missile',
    '1st-level evocation',
    'Casting Time: 1 action',
    'Range: 120 feet',
    'Components: V, S',
    'Duration: Instantaneous',
    'You create three glowing darts of magical force.',
    'At Higher Levels. When you cast this spell using a spell slot of 2nd level or higher, the spell creates one more dart for each slot level above 1st.',
    'MAGIC_MISSILE_FINAL_LINE_THAT_MUST_NOT_BE_DROPPED.',
  ],
};

// Closing chapter so the spell-descriptions anchor has an end heading to find.
const MONSTERS_PAGE: FixturePage = {
  lines: ['Monsters', 'Goblin', 'Small humanoid (goblinoid), neutral evil.'],
};

const COMBAT_ACTIONS_PAGE: FixturePage = {
  lines: [
    'Actions in Combat',
    'Attack',
    'The most common action to take in combat is the Attack action.',
    '',
    'Cast a Spell',
    'Spellcasters can use their action to cast a spell with a casting time of 1 action.',
    '',
    'Dash',
    'When you take the Dash action, you gain extra movement for the current turn.',
    '',
    'Disengage',
    "If you take the Disengage action, your movement doesn't provoke opportunity attacks.",
    '',
    'Dodge',
    'When you take the Dodge action, you focus entirely on avoiding attacks.',
    '',
    'Help',
    'You can lend your aid to another creature in the completion of a task.',
    '',
    'Hide',
    'You make a Dexterity (Stealth) check in an attempt to hide.',
    '',
    'Ready',
    'First, you decide what perceivable circumstance will trigger your reaction.',
    '',
    'Search',
    'You devote your attention to finding something.',
    '',
    'Use an Object',
    'You normally interact with an object while doing something else.',
  ],
};

const MAKING_AN_ATTACK_PAGE: FixturePage = {
  lines: [
    'Making an Attack',
    'Whether you are striking with a melee weapon, firing a weapon at range,',
    'or making an attack roll as part of a spell, an attack has a simple structure.',
  ],
};

const COMBAT_ACTIONS_PAGE_MISSING_END: FixturePage = {
  lines: [
    'Actions in Combat',
    'Attack',
    'The most common action to take in combat is the Attack action.',
    '',
    'Cast a Spell',
    'Spellcasters can use their action to cast a spell with a casting time of 1 action.',
    '',
    'Use an Object',
    'You normally interact with an object while doing something else.',
    '',
    'Later combat prose without an ending chapter heading',
    'This line should not be consumed by the action parser to EOF.',
  ],
};

// Hazards fixture: mirrors the SRD "Dungeon Hazards" section (Brown Mold only
// here; 4 hazards in the real SRD). The heading "Dungeon Hazards" matches the
// hazards startHeading anchor; "Traps" below acts as the end heading.
const HAZARDS_PAGE: FixturePage = {
  lines: [
    'Dungeon Hazards',
    'Brown Mold',
    'Brown mold feeds on warmth, draining heat from everything nearby.',
    '',
    'Traps',
    'A trap can be either mechanical or magical in nature.',
  ],
};

// Hazards fixture without the end heading. This reproduces the bug where the
// importer would otherwise run hazards to EOF and absorb later text.
const HAZARDS_PAGE_MISSING_END: FixturePage = {
  lines: [
    'Dungeon Hazards',
    'Brown Mold',
    'Brown mold feeds on warmth, draining heat from everything nearby.',
    '',
    'Later DM tools prose',
    'This text should not be included in the hazards section.',
  ],
};

// Feats fixture: mirrors the SRD "Feats" section (only Grappler in SRD 5.1).
const FEATS_PAGE: FixturePage = {
  lines: [
    'Feats',
    'Grappler',
    'Prerequisite: Strength 13 or higher',
    "You've developed the skills necessary to hold your own in close-quarters grappling.",
    '• You have advantage on attack rolls against a creature you are grappling.',
  ],
};

// Core-rules fixture: mirrors "Using Ability Scores" through combat/adventuring
// subsections where rule-text entries like "Cover" and "Resting" appear.
// The core-rules section ends at "Spell Lists" (handled by section anchors).
const CORE_RULES_PAGE_ONE: FixturePage = {
  lines: [
    'Using Ability Scores',
    'Cover',
    'Walls, trees, creatures, and other obstacles can provide cover during combat.',
    'A target with half cover has a +2 bonus to AC and Dexterity saving throws.',
  ],
};

const CORE_RULES_PAGE_TWO: FixturePage = {
  lines: [
    'Resting',
    'Adventurers can take short rests and long rests to recover from wounds.',
    'A short rest is at least 1 hour long, and a long rest is at least 8 hours.',
  ],
};

const CORE_RULES_TABLES_PAGE: FixturePage = {
  lines: [
    'Difficulty Classes',
    'Task Difficulty',
    'DC',
    'Very easy 5',
    'Easy 10',
    'Medium 15',
    'Hard 20',
    'Very hard 25',
    'Nearly impossible 30',
    '',
    'XP Thresholds by Character Level',
    'Character Level',
    'Easy',
    'Medium',
    'Hard',
    'Deadly',
    '1st 25 50 75 100',
    '2nd 50 100 150 200',
    '3rd 75 150 225 400',
    '4th 125 250 375 500',
  ],
};

// Conditions fixture: mirrors "Appendix A: Conditions" with two representative
// conditions (Blinded for a flat-effect case, Prone for a single-effect case).
const CONDITIONS_PAGE: FixturePage = {
  lines: [
    'Appendix A: Conditions',
    'Blinded',
    "• A blinded creature can't see and automatically fails any ability check that requires sight.",
    "• Attack rolls against the creature have advantage, and the creature's attack rolls have disadvantage.",
    '',
    'Prone',
    '• A prone creature has disadvantage on attack rolls.',
    '• An attack roll against the creature has advantage if the attacker is within 5 feet.',
  ],
};

describe('runImporter — end-to-end against a fixture PDF', () => {
  it('extracts spells, conditions, feats, hazards, actions, and rules — writes a pack that loads through loadRulesPackFromDirectory', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      CORE_RULES_TABLES_PAGE,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      CONDITIONS_PAGE,
    ]);

    const result = await runImporter({ pdfPath, outDir });
    expect(result.counts.spells).toBe(2);
    expect(result.counts.conditions).toBe(2);
    expect(result.counts.feats).toBe(1);
    expect(result.counts.hazards).toBe(1);
    expect(result.counts.actions).toBe(10);
    expect(result.counts.rules).toBe(2);
    expect(result.counts.tables).toBe(2);
    expect(result.sourceHash).toMatch(/^[0-9a-f]{64}$/);

    const pack = loadRulesPackFromDirectory(outDir);
    expect(pack.records).toHaveLength(20);
    const keys = pack.records.map((r) => r.key).sort();
    expect(keys).toContain('action:attack');
    expect(keys).toContain('action:cast-a-spell');
    expect(keys).toContain('action:dash');
    expect(keys).toContain('action:disengage');
    expect(keys).toContain('action:dodge');
    expect(keys).toContain('action:help');
    expect(keys).toContain('action:hide');
    expect(keys).toContain('action:ready');
    expect(keys).toContain('action:search');
    expect(keys).toContain('action:use-an-object');
    expect(keys).toContain('spell:acid-splash');
    expect(keys).toContain('spell:magic-missile');
    expect(keys).toContain('condition:blinded');
    expect(keys).toContain('condition:prone');
    expect(keys).toContain('feat:grappler');
    expect(keys).toContain('rule:cover');
    expect(keys).toContain('rule:resting');
    expect(keys).toContain('table:difficulty-classes');
    expect(keys).toContain('table:xp-thresholds-by-character-level');
    // Assert the feat set is exactly Grappler — no bogus chapter headings
    // promoted as feat names by the heuristic.
    const featKeys = keys.filter((k) => k.startsWith('feat:'));
    expect(featKeys).toEqual(['feat:grappler']);
    // Assert the hazard set is exactly Brown Mold.
    const hazardKeys = keys.filter((k) => k.startsWith('hazard:'));
    expect(hazardKeys).toEqual(['hazard:brown-mold']);
    const actionKeys = keys.filter((k) => k.startsWith('action:'));
    expect(actionKeys).toEqual([
      'action:attack',
      'action:cast-a-spell',
      'action:dash',
      'action:disengage',
      'action:dodge',
      'action:help',
      'action:hide',
      'action:ready',
      'action:search',
      'action:use-an-object',
    ]);
    const ruleKeys = keys.filter((k) => k.startsWith('rule:'));
    expect(ruleKeys).toEqual(['rule:cover', 'rule:resting']);
    const tableKeys = keys.filter((k) => k.startsWith('table:'));
    expect(tableKeys).toEqual([
      'table:difficulty-classes',
      'table:xp-thresholds-by-character-level',
    ]);

    const acid = pack.records.find((r) => r.key === 'spell:acid-splash');
    expect(acid?.name).toBe('Acid Splash');
    const acidData = acid?.data as Record<string, unknown>;
    expect(acidData.level).toBe(0);
    expect(acidData.school).toBe('conjuration');
    expect(acidData.classes).toEqual(['Sorcerer', 'Wizard']);

    const hazardRecords = pack.records.filter((r) => r.kind === 'hazard');
    expect(hazardRecords.map((r) => r.key)).toEqual(['hazard:brown-mold']);
    expect(hazardRecords.map((r) => r.name)).toEqual(['Brown Mold']);
    const brown = hazardRecords[0];
    const brownData = brown?.data as Record<string, unknown>;
    expect(brownData.description).not.toMatch(
      /A trap can be either mechanical or magical in nature\./,
    );

    const mm = pack.records.find((r) => r.key === 'spell:magic-missile');
    const mmData = mm?.data as Record<string, unknown>;
    expect(mmData.level).toBe(1);
    expect(mmData.higherLevels).toMatch(/^When you cast this spell/);

    const blinded = pack.records.find((r) => r.key === 'condition:blinded');
    expect(blinded?.name).toBe('Blinded');
    const blindedData = blinded?.data as Record<string, unknown>;
    expect(typeof blindedData.description).toBe('string');
    expect((blindedData.description as string).length).toBeGreaterThan(0);

    const grappler = pack.records.find((r) => r.key === 'feat:grappler');
    expect(grappler?.name).toBe('Grappler');
    const grapplerData = grappler?.data as Record<string, unknown>;
    expect(grapplerData.prerequisites).toBe('Strength 13 or higher');
    expect(typeof grapplerData.description).toBe('string');
    expect((grapplerData.description as string).length).toBeGreaterThan(0);

    const cover = pack.records.find((r) => r.key === 'rule:cover');
    expect(cover?.name).toBe('Cover');
    const coverData = cover?.data as Record<string, unknown>;
    expect(typeof coverData.text).toBe('string');
    expect((coverData.text as string).length).toBeGreaterThan(0);
    expect(coverData.text).toMatch(/provide cover during combat/i);

    const difficultyTable = pack.records.find(
      (r) => r.key === 'table:difficulty-classes',
    );
    expect((difficultyTable?.data as Record<string, unknown>).columns).toEqual([
      'Task Difficulty',
      'DC',
    ]);
    expect((difficultyTable?.data as Record<string, unknown>).rows).toEqual([
      ['Very easy', 5],
      ['Easy', 10],
      ['Medium', 15],
      ['Hard', 20],
      ['Very hard', 25],
      ['Nearly impossible', 30],
    ]);

    const xpThresholdTable = pack.records.find(
      (r) => r.key === 'table:xp-thresholds-by-character-level',
    );
    expect((xpThresholdTable?.data as Record<string, unknown>).columns).toEqual(
      ['Character Level', 'Easy', 'Medium', 'Hard', 'Deadly'],
    );
    expect((xpThresholdTable?.data as Record<string, unknown>).rows).toEqual([
      ['1st', 25, 50, 75, 100],
      ['2nd', 50, 100, 150, 200],
      ['3rd', 75, 150, 225, 400],
      ['4th', 125, 250, 375, 500],
    ]);
  });

  it('produces a byte-identical pack across two runs over the same PDF', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outA = join(workDir, 'a');
    const outB = join(workDir, 'b');
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      CONDITIONS_PAGE,
    ]);

    await runImporter({ pdfPath, outDir: outA });
    await runImporter({ pdfPath, outDir: outB });

    expect(readFileSync(join(outA, 'manifest.json'), 'utf8')).toBe(
      readFileSync(join(outB, 'manifest.json'), 'utf8'),
    );
    expect(readFileSync(join(outA, 'records.json'), 'utf8')).toBe(
      readFileSync(join(outB, 'records.json'), 'utf8'),
    );
  });

  it('preserves the final line of the final spell (body-slicing regression)', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      CONDITIONS_PAGE,
    ]);

    await runImporter({ pdfPath, outDir });
    const pack = loadRulesPackFromDirectory(outDir);
    const mm = pack.records.find((r) => r.key === 'spell:magic-missile');
    const mmData = mm?.data as Record<string, unknown>;
    const haystack = `${mmData.description ?? ''}\n${mmData.higherLevels ?? ''}`;
    expect(haystack).toMatch(
      /MAGIC_MISSILE_FINAL_LINE_THAT_MUST_NOT_BE_DROPPED/,
    );
  });

  it("does not bleed class-list or monster text into the final spell's body", async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE,
      FEATS_PAGE,
      CONDITIONS_PAGE,
    ]);

    await runImporter({ pdfPath, outDir });
    const pack = loadRulesPackFromDirectory(outDir);

    for (const record of pack.records) {
      const data = record.data as Record<string, unknown>;
      const haystack = [
        data.description,
        data.higherLevels,
        data.componentMaterials,
      ]
        .filter((v): v is string => typeof v === 'string')
        .join('\n');
      // Class-list section headers / content must not appear inside any
      // spell's textual fields.
      expect(haystack).not.toMatch(/Wizard Spells/);
      expect(haystack).not.toMatch(/Sorcerer Spells/);
      expect(haystack).not.toMatch(/Cantrips \(0 Level\)/);
      expect(haystack).not.toMatch(/^Acid Splash$/m);
      // Following-chapter (monsters) content must not appear either.
      expect(haystack).not.toMatch(/Monsters/);
      expect(haystack).not.toMatch(/Goblin/);
      expect(haystack).not.toMatch(/Small humanoid/);
    }
  });

  it('fails closed when the spell-descriptions anchor cannot be found', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // Fixture with neither a "Spells" nor a "Spell Lists" heading — the
    // importer must refuse to run rather than silently feed the whole PDF
    // to the parser.
    const orphan: FixturePage = {
      lines: ['Acid Splash', 'Conjuration cantrip'],
    };
    await writeFixturePdf(pdfPath, [orphan]);
    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      /heading not found/,
    );
  });

  it('fails closed when the conditions heading is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // Spell Lists, Spells, Monsters, and Feats are present so those pipelines
    // succeed, but there is no conditions chapter. The importer must refuse
    // to run rather than silently emit a pack without conditions.
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      FEATS_PAGE,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
    ]);
    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      /heading not found/,
    );
  });

  it('fails closed when the spell-descriptions end heading (e.g. "Monsters") is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // Spell Lists and Spells start headings are present (so spellLists slice
    // succeeds and spellDescriptions start is found), but the chapter after
    // Spells is missing — pre-fix this would have silently sliced the spell
    // descriptions to EOF and let any later content bleed in. With
    // requireEndHeading: true, the importer must refuse to run.
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
    ]);
    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      /end heading not found/,
    );
  });

  it('fails closed when the feats end heading is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    // All sections except the feats end heading are present. FEATS_PAGE is
    // placed last so no subsequent heading matches the feats endHeading pattern.
    // With requireEndHeading: true on the feats anchor, the importer must
    // throw SectionNotFoundError rather than silently slice to EOF (which would
    // let later chapter headings be promoted as bogus feat records).
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      CONDITIONS_PAGE,
      FEATS_PAGE,
    ]);
    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      /end heading not found/,
    );
  });

  it('fails closed when the hazards end heading is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      COMBAT_ACTIONS_PAGE,
      MAKING_AN_ATTACK_PAGE,
      HAZARDS_PAGE_MISSING_END,
      FEATS_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      SectionNotFoundError,
    );
  });

  it('fails closed when the combat-actions end heading is missing', async () => {
    const workDir = makeTmpDir();
    const pdfPath = join(workDir, 'fixture.pdf');
    const outDir = join(workDir, 'pack');
    await writeFixturePdf(pdfPath, [
      CORE_RULES_PAGE_ONE,
      CORE_RULES_PAGE_TWO,
      SPELL_LISTS_PAGE,
      SPELLS_PAGE,
      MONSTERS_PAGE,
      COMBAT_ACTIONS_PAGE_MISSING_END,
      HAZARDS_PAGE,
      FEATS_PAGE,
      CONDITIONS_PAGE,
    ]);

    await expect(runImporter({ pdfPath, outDir })).rejects.toThrow(
      SectionNotFoundError,
    );
  });
});
