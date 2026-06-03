/**
 * Default-on coverage and audit tests for the committed D&D 5e SRD 5.1
 * rules-pack at `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/`.
 *
 * These tests operate on the COMMITTED pack on disk — not on importer output.
 * Per the 0m9.6 design, the importer is treated as a one-shot construction
 * tool. Continuously re-running it on every PR is the path-gated
 * `verify:dnd5e-srd-pack` job's responsibility, not vitest's.
 *
 * What this file guards:
 *   - The committed pack still loads and validates.
 *   - Per-kind counts match the canonical full-pack baseline literal
 *     (loreweaver-1pw replaced the two-record seed pack with the importer's
 *     full deterministic output from the vendored SRD 5.1 PDF).
 *   - Key shape is consistent and unique.
 *   - A representative stable key from every kind is present.
 *   - The generic `auditPack` heuristic surfaces no suspicious records, and the
 *     set of partially-populated optional data fields matches an explicitly
 *     reviewed baseline (these are genuinely-optional SRD fields — e.g. a spell
 *     `ritual` flag or an ancestry `subraces` list — present on some records of
 *     a kind and absent on others, not parser drift).
 *   - The pack's license/source manifest aligns with the vendored source
 *     manifest at `packages/core/sources/dnd5e-srd-5.1/manifest.json`.
 *
 * Out of scope (see bead notes):
 *   - Exact creature name-set validation → `loreweaver-0m9.5.14`.
 *   - Pathfinder coverage → `loreweaver-0m9.9`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXPECTED_SRD_5_1_CREATURE_NAMES,
  MIN_EXPECTED_SRD_5_1_CREATURES,
} from '../scripts/importers/dnd5e-srd-5.1/index.js';
import {
  auditPack,
  loadRulesPackFromDirectory,
  validateRulesPack,
} from '../src/internal.js';

const PACK_DIR = join(
  process.cwd(),
  'packages/core/data/rules-packs/rules__dnd5e-srd-5.1',
);

const SOURCE_MANIFEST_PATH = join(
  process.cwd(),
  'packages/core/sources/dnd5e-srd-5.1/manifest.json',
);

interface SrdSourceManifest {
  readonly sourceTitle: string;
  readonly sourceVersion: string;
  readonly license: {
    readonly name: string;
    readonly url: string;
  };
  readonly artifact: {
    readonly sourceUrl: string;
    readonly sha256: string;
  };
  readonly attribution: {
    readonly text: string;
  };
}

function readSourceManifest(): SrdSourceManifest {
  return JSON.parse(
    readFileSync(SOURCE_MANIFEST_PATH, 'utf8'),
  ) as SrdSourceManifest;
}

/**
 * Per-kind record-count baseline for the committed canonical pack at
 * `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/`. These are the exact
 * per-kind counts the deterministic importer produces from the vendored
 * SRD 5.1 PDF (loreweaver-1pw); `npm run verify:dnd5e-srd-pack` proves the
 * committed pack equals importer output byte-for-byte.
 *
 * The match is exact: the test fails if a kind appears or disappears, or any
 * count drifts. That's the regression-guard intent — accidental edits to the
 * committed pack, or an importer/parser change that silently alters coverage,
 * do not slip through unnoticed. An intentional coverage change updates this
 * literal (and re-runs the verify command) as part of that change.
 */
const EXPECTED_COUNTS_BY_KIND: Readonly<Record<string, number>> = {
  action: 10,
  ancestry: 13,
  class: 12,
  condition: 15,
  creature: 296,
  equipment: 1,
  feat: 1,
  feature: 144,
  rule: 10,
  spell: 319,
  subclass: 12,
  table: 1,
};

/**
 * One representative stable key per kind that must be present in the committed
 * pack — a coarse spot-check that the parse for each kind produced its expected
 * landmark records. Exact full-set coverage per kind lives in the importer's
 * own coverage gates and per-parser tests, not here.
 */
const EXPECTED_STABLE_KEYS: readonly string[] = [
  'action:dodge',
  'ancestry:elf',
  'ancestry:hill-dwarf',
  'class:wizard',
  'condition:blinded',
  'condition:exhaustion',
  'creature:goblin',
  'creature:aboleth',
  'equipment:padded',
  'feat:grappler',
  'feature:champion:improved-critical',
  'rule:difficult-terrain',
  'spell:fire-bolt',
  'spell:wish',
  'subclass:champion',
  'table:difficulty-classes',
];

/**
 * Reviewed baseline of partially-populated optional `data` fields — fields
 * present on some records of a kind and absent on others. Each entry here was
 * reviewed (loreweaver-1pw) and is a genuinely-optional SRD field, NOT a
 * parser-drift signal:
 *   - ancestry.subraceOf / subraces: only subraces carry `subraceOf`; only
 *     races-with-subraces carry `subraces`.
 *   - condition.effects: present on all conditions except Exhaustion, whose
 *     mechanics live in its per-level `levels` table.
 *   - condition.levels: only Exhaustion has graded levels.
 *   - spell.componentMaterials: only spells with a material (M) component.
 *   - spell.higherLevels: only spells with an "At Higher Levels" entry.
 *   - spell.ritual: only spells tagged as rituals.
 * The audit reports `0 < missingCount < totalInKind` per field; we pin the
 * compact {kind, field, missingCount, totalInKind} projection so a new
 * partially-populated field (a real drift signal) fails the test, while the
 * long `affectedKeys` lists stay out of the baseline to keep it maintainable.
 */
const EXPECTED_PARTIAL_FIELDS: ReadonlyArray<{
  readonly kind: string;
  readonly field: string;
  readonly missingCount: number;
  readonly totalInKind: number;
}> = [
  { kind: 'ancestry', field: 'subraceOf', missingCount: 9, totalInKind: 13 },
  { kind: 'ancestry', field: 'subraces', missingCount: 9, totalInKind: 13 },
  { kind: 'condition', field: 'effects', missingCount: 1, totalInKind: 15 },
  { kind: 'condition', field: 'levels', missingCount: 14, totalInKind: 15 },
  {
    kind: 'spell',
    field: 'componentMaterials',
    missingCount: 135,
    totalInKind: 319,
  },
  { kind: 'spell', field: 'higherLevels', missingCount: 227, totalInKind: 319 },
  { kind: 'spell', field: 'ritual', missingCount: 290, totalInKind: 319 },
];

// `<kind>:<kebab-slug>` with one or more colon-separated slug segments. Most
// kinds use a single segment (`spell:fire-bolt`); class/subclass-scoped
// features namespace the slug (`feature:bard:ability-score-improvement`).
const KEY_PATTERN = /^[a-z][a-z0-9]*(?::[a-z0-9][a-z0-9-]*)+$/;

/**
 * PDF hyphen-cluster artifacts that must NOT survive into the durable pack.
 * The SRD 5.1 PDF font renders every word-internal hyphen as an ASCII hyphen
 * wrapped in invisible presentation hyphens (U+00AD SOFT HYPHEN, U+2010 HYPHEN,
 * U+2011 NON-BREAKING HYPHEN). The extractor collapses those clusters to a lone
 * ASCII hyphen (`normalizePdfHyphenCluster` in the importer's `extract.ts`), so
 * a regenerated canonical pack must contain none of these code points
 * (loreweaver-6uy). The class is written with explicit `\uXXXX` escapes so this
 * test source embeds no invisible characters; en-dash (U+2013) and em-dash
 * (U+2014) are legitimate SRD punctuation and intentionally excluded.
 */
const FORBIDDEN_HYPHEN_CODE_POINTS: ReadonlyArray<{
  readonly name: string;
  readonly codePoint: number;
}> = [
  { name: 'U+00AD SOFT HYPHEN', codePoint: 0x00ad },
  { name: 'U+2010 HYPHEN', codePoint: 0x2010 },
  { name: 'U+2011 NON-BREAKING HYPHEN', codePoint: 0x2011 },
];

describe('D&D 5e SRD 5.1 committed pack', () => {
  const pack = loadRulesPackFromDirectory(PACK_DIR);

  describe('schema validity', () => {
    it('loads and re-validates without error', () => {
      // `loadRulesPackFromDirectory` already ran validateRulesPack; re-running
      // on the loaded object asserts the in-memory pack is still well-formed
      // (no shared mutation introduced by an upstream helper).
      expect(() => validateRulesPack(pack)).not.toThrow();
    });

    it('declares the canonical packId for D&D 5e SRD 5.1', () => {
      expect(pack.meta.packId).toBe('rules:dnd5e-srd-5.1');
      expect(pack.meta.systemId).toBe('dnd5e-srd');
      expect(pack.meta.version).toBe('5.1');
      expect(pack.meta.role).toBe('base');
    });
  });

  describe('category counts', () => {
    it('per-kind counts exactly match the documented baseline', () => {
      const audit = auditPack(pack);
      expect(audit.countsByKind).toEqual(EXPECTED_COUNTS_BY_KIND);
    });

    it('total record count matches the sum of per-kind counts', () => {
      const expectedTotal = Object.values(EXPECTED_COUNTS_BY_KIND).reduce(
        (sum, n) => sum + n,
        0,
      );
      expect(pack.records).toHaveLength(expectedTotal);
    });
  });

  describe('record keys', () => {
    it('every key matches the `<kind>:<kebab-slug>` shape', () => {
      for (const record of pack.records) {
        expect(record.key).toMatch(KEY_PATTERN);
      }
    });

    it('every key begins with its own record kind as the prefix', () => {
      for (const record of pack.records) {
        const [prefix] = record.key.split(':');
        expect(prefix).toBe(record.kind);
      }
    });

    it('all keys are unique within the pack', () => {
      const keys = pack.records.map((record) => record.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('contains the documented set of stable spot-check keys', () => {
      const keys = new Set(pack.records.map((record) => record.key));
      for (const expected of EXPECTED_STABLE_KEYS) {
        expect(keys.has(expected)).toBe(true);
      }
    });
  });

  // `EXPECTED_SRD_5_1_CREATURE_NAMES` (loreweaver-0m9.5.14) is a reviewed,
  // checked-in baseline — a candidate generated from the vendored PDF, reviewed
  // against the SRD source, then committed (see its doc comment and
  // `npm run generate:dnd5e-srd-creature-names`). This test does NOT derive the
  // expected names at runtime: it compares the committed pack's creature record
  // names against that fixed baseline. Its purpose is regression protection —
  // not a standalone proof of SRD completeness. Once the reviewed baseline is
  // committed, a parser change that drops, adds, or renames a creature record
  // breaks this test until the baseline is regenerated, re-reviewed, and updated
  // in the same change.
  describe('creature name-set regression baseline (loreweaver-0m9.5.14)', () => {
    const packCreatureNames = pack.records
      .filter((record) => record.kind === 'creature')
      .map((record) => record.name);

    it('committed pack creature names match the checked-in baseline exactly', () => {
      expect([...packCreatureNames].sort()).toEqual(
        [...EXPECTED_SRD_5_1_CREATURE_NAMES].sort(),
      );
    });

    it('EXPECTED_SRD_5_1_CREATURE_NAMES has no duplicates', () => {
      expect(new Set(EXPECTED_SRD_5_1_CREATURE_NAMES).size).toBe(
        EXPECTED_SRD_5_1_CREATURE_NAMES.length,
      );
    });

    it('the expected name-set length equals the documented count baseline', () => {
      expect(EXPECTED_SRD_5_1_CREATURE_NAMES).toHaveLength(
        MIN_EXPECTED_SRD_5_1_CREATURES,
      );
      expect(MIN_EXPECTED_SRD_5_1_CREATURES).toBe(
        EXPECTED_COUNTS_BY_KIND.creature,
      );
    });
  });

  // loreweaver-7ok: the alphabetic Spell Descriptions section ends with "Zone
  // of Truth", immediately followed by the gamemastering "Traps" subsection;
  // and the SRD justifies paragraphs, so the "Wish" spell's right-aligned last
  // word "wish" sat just left of the page gutter on p193. Two distinct bugs
  // corrupted the final spell bodies: the spell-descriptions end anchor missed
  // "Traps" (so "Zone of Truth" absorbed the entire Traps→Poisons run), and the
  // column splitter swept "wish" into the right column (so "Word of Recall"
  // gained a stray "wish" mid-sentence). Both are fixed at the importer; these
  // assertions guard the committed pack against either regressing.
  describe('spell-section boundary regression (loreweaver-7ok)', () => {
    function spellDescription(key: string): string {
      const record = pack.records.find((r) => r.key === key);
      expect(record, `expected ${key} in the committed pack`).toBeDefined();
      const data = record?.data as { description?: unknown };
      expect(typeof data.description).toBe('string');
      return data.description as string;
    }

    it('Word of Recall body matches the SRD and carries no neighboring-spell contamination', () => {
      const description = spellDescription('spell:word-of-recall');
      // The true SRD sentence runs straight from "isn't" to "dedicated".
      expect(description).toContain(
        'in an area that isn’t dedicated to your deity, the spell has no effect.',
      );
      expect(description.endsWith('the spell has no effect.')).toBe(true);
      // The pre-fix artifact: the Wish spell's stray "wish" wedged between
      // "isn't" and "dedicated". No standalone "wish" token may remain.
      expect(description).not.toMatch(/\bwish\b/i);
    });

    it('Zone of Truth body ends at the spell boundary and excludes the Traps section', () => {
      const description = spellDescription('spell:zone-of-truth');
      expect(
        description.endsWith('it remains within the boundaries of the truth.'),
      ).toBe(true);
      // The pre-fix artifact: the end anchor missed "Traps", so the body ran on
      // through Traps, Diseases, Madness, Objects, and the Poisons table. None
      // of those landmarks may appear in the spell body.
      for (const leaked of [
        'Traps can be found',
        'Purple Worm Poison',
        'Serpent Venom',
        'Truth Serum',
      ]) {
        expect(description).not.toContain(leaked);
      }
      // A faithful Zone of Truth body is short; the contaminated one was
      // ~38k characters of trailing gamemastering text.
      expect(description.length).toBeLessThan(2000);
    });
  });

  describe('audit findings', () => {
    it('reports no suspicious records', () => {
      const audit = auditPack(pack);
      expect(audit.suspiciousRecords).toEqual([]);
    });

    it('partially-populated optional fields match the reviewed baseline', () => {
      const audit = auditPack(pack);
      const compact = audit.missingFieldSummary.map((group) => ({
        kind: group.kind,
        field: group.field,
        missingCount: group.missingCount,
        totalInKind: group.totalInKind,
      }));
      expect(compact).toEqual(EXPECTED_PARTIAL_FIELDS);
    });
  });

  describe('hidden-Unicode hygiene', () => {
    // Read the committed records.json verbatim (not the parsed pack) so the
    // assertion covers the exact bytes that ship — the durable artifact a
    // consumer downloads — rather than a post-load reconstruction.
    const recordsJson = readFileSync(join(PACK_DIR, 'records.json'), 'utf8');

    for (const { name, codePoint } of FORBIDDEN_HYPHEN_CODE_POINTS) {
      it(`contains no ${name} (PDF hyphen-cluster artifact)`, () => {
        const count = [...recordsJson].filter(
          (ch) => ch.codePointAt(0) === codePoint,
        ).length;
        expect(count).toBe(0);
      });
    }
  });

  describe('source-manifest alignment with the vendored SRD artifact', () => {
    const sourceManifest = readSourceManifest();

    it('pack source title and version match the vendored manifest', () => {
      expect(pack.meta.source.sourceTitle).toBe(sourceManifest.sourceTitle);
      expect(pack.meta.source.sourceVersion).toBe(sourceManifest.sourceVersion);
    });

    it('pack license name matches the vendored manifest', () => {
      expect(pack.meta.license.licenseName).toBe(sourceManifest.license.name);
    });

    it('pack records carry the verbatim SRD 5.1 attribution text', () => {
      // The vendored manifest's attribution.text is the verbatim Legal
      // Information preamble from the SRD PDF (loreweaver-bnb). The pack-level
      // license MUST carry that exact string; each record's per-record license
      // copy MUST also carry it. Paraphrasing is a licensing regression.
      expect(pack.meta.license.attributionText).toBe(
        sourceManifest.attribution.text,
      );
      for (const record of pack.records) {
        expect(record.license.attributionText).toBe(
          sourceManifest.attribution.text,
        );
      }
    });

    it('every record provenance references the SRD 5.1 source URL', () => {
      const sourceUrl = pack.meta.source.sourceUrl;
      expect(typeof sourceUrl).toBe('string');
      for (const record of pack.records) {
        expect(record.provenance.sourceRef).toBe(sourceUrl);
      }
    });
  });
});
