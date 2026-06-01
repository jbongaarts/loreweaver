/**
 * Source-artifact pin verification for the vendored D&D SRD 5.1 PDF.
 *
 * The PDF lives at `packages/core/sources/dnd5e-srd-5.1/SRD_CC_v5.1.pdf` per
 * loreweaver-60z and is meant to be the deterministic input the 0m9.5
 * importer and 0m9.10 audit tooling run against. The fingerprint we treat as
 * authoritative is `packages/core/sources/dnd5e-srd-5.1/manifest.json`. This
 * test enforces that the bytes on disk still match that pin: the file is
 * present, its size matches `artifact.sizeBytes`, and its SHA-256 matches
 * `artifact.sha256`.
 *
 * Failure modes this catches:
 *   - PDF deleted / missing (e.g. someone re-applied an over-broad ignore).
 *   - PDF swapped for a different version or a re-downloaded copy whose bytes
 *     differ (Wizards republishes the URL, or a download corrupted).
 *   - Manifest edited without re-pinning the new hash.
 *   - Wrong artifact committed under the SRD filename.
 *
 * This is purely an artifact-pin invariant. It does NOT exercise importer or
 * parser behavior, does not assert record counts, and does not encode any
 * coverage list -- those concerns live in their own beads.
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface SrdSourceManifest {
  readonly sourceTitle: string;
  readonly sourceVersion: string;
  readonly artifact: {
    readonly filename: string;
    readonly sizeBytes: number;
    readonly sha256: string;
  };
}

const SOURCE_DIR = 'packages/core/sources/dnd5e-srd-5.1';

function readManifest(): SrdSourceManifest {
  const manifestPath = join(process.cwd(), SOURCE_DIR, 'manifest.json');
  const raw = readFileSync(manifestPath, 'utf8');
  return JSON.parse(raw) as SrdSourceManifest;
}

describe('SRD 5.1 vendored source artifact', () => {
  const manifest = readManifest();
  const pdfPath = join(process.cwd(), SOURCE_DIR, manifest.artifact.filename);

  it('manifest pins the expected SRD 5.1 identity', () => {
    expect(manifest.sourceTitle).toBe('System Reference Document 5.1');
    expect(manifest.sourceVersion).toBe('5.1');
    expect(manifest.artifact.filename).toBe('SRD_CC_v5.1.pdf');
    // SHA-256 hex strings are 64 lowercase hex chars; assert shape so a
    // typo'd or truncated pin can't quietly pass the byte-match check below.
    expect(manifest.artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.artifact.sizeBytes).toBeGreaterThan(0);
  });

  it('committed PDF matches the manifest size and SHA-256', () => {
    const stat = statSync(pdfPath);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBe(manifest.artifact.sizeBytes);

    const bytes = readFileSync(pdfPath);
    expect(bytes.byteLength).toBe(manifest.artifact.sizeBytes);

    const hash = createHash('sha256').update(bytes).digest('hex');
    expect(hash).toBe(manifest.artifact.sha256);
  });
});
