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
 *   - Per-kind counts match a small baseline literal (today the seed pack);
 *     the canonical-regen PR updates this literal.
 *   - Key shape is consistent and unique.
 *   - A handful of known stable keys are present.
 *   - The generic `auditPack` heuristic surfaces no suspicious records or
 *     partially-populated data fields (clean today; the regen PR fixes any
 *     new findings or documents a baseline before merging).
 *   - The pack's license/source manifest aligns with the vendored source
 *     manifest at `packages/core/sources/dnd5e-srd-5.1/manifest.json`.
 *
 * Out of scope (see bead notes):
 *   - Exact creature name-set validation → `loreweaver-0m9.5.14`.
 *   - Regenerating the canonical pack → future bead/PR.
 *   - Pathfinder coverage → `loreweaver-0m9.9`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
 * Per-kind record-count baseline for the committed pack. The committed pack at
 * `packages/core/data/rules-packs/rules__dnd5e-srd-5.1/` is currently a seed
 * pack with two hand-curated records (the 0m9.5 importer's canonical-pack
 * regen has not landed yet). When that regen PR lands, this literal is updated
 * to the importer's per-kind counts and `EXPECTED_STABLE_KEYS` grows to match.
 *
 * The match is exact: the test fails if a kind appears or disappears, or any
 * count drifts. That's the regression-guard intent — accidental edits to the
 * committed pack do not slip through unnoticed.
 */
const EXPECTED_COUNTS_BY_KIND: Readonly<Record<string, number>> = {
  creature: 1,
  spell: 1,
};

/**
 * Selected stable keys that must be present in the committed pack. The list is
 * intentionally small while the pack is a seed; it expands alongside
 * `EXPECTED_COUNTS_BY_KIND` whenever the canonical-regen PR lands.
 */
const EXPECTED_STABLE_KEYS: readonly string[] = [
  'creature:goblin',
  'spell:fire-bolt',
];

const KEY_PATTERN = /^[a-z][a-z0-9]*:[a-z0-9][a-z0-9-]*$/;

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

  describe('audit findings', () => {
    it('reports no suspicious records', () => {
      const audit = auditPack(pack);
      expect(audit.suspiciousRecords).toEqual([]);
    });

    it('reports no partially-populated data fields', () => {
      const audit = auditPack(pack);
      expect(audit.missingFieldSummary).toEqual([]);
    });
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
