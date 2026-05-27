/**
 * Programmatic API for the D&D 5e SRD 5.1 importer.
 *
 * `runImporter` is the single entry point: reads the vendored PDF, extracts
 * text, parses spells (and spell-class lists), builds a validated
 * `RulesPack`, and writes `manifest.json` + `records.json` to the requested
 * output directory.
 *
 * Scope today: spells only. Other SRD record kinds are tracked under
 * `loreweaver-0m9.5` child issues; until those parsers ship the importer
 * deliberately omits them so the generated pack does not claim coverage it
 * does not have. See `README.md` next to this file for the breakdown.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildPack, writePackToDirectory } from './emit.js';
import { extractPdfText } from './extract.js';
import { parseSpellClassLists, parseSpells } from './parseSpells.js';
import type { ImporterRunResult } from './types.js';

export interface RunImporterInput {
  /** Absolute path to the vendored SRD 5.1 PDF. */
  readonly pdfPath: string;
  /** Output directory; receives manifest.json + records.json. */
  readonly outDir: string;
}

export async function runImporter(
  input: RunImporterInput,
): Promise<ImporterRunResult> {
  const pdfBytes = readFileSync(input.pdfPath);
  const sourceHash = sha256Hex(pdfBytes);
  const pages = await extractPdfText(new Uint8Array(pdfBytes));
  const spells = parseSpells(pages);
  const classIndex = parseSpellClassLists(pages);
  const pack = buildPack({ spells, classIndex, sourceHash });
  writePackToDirectory(pack, { outDir: input.outDir });
  return {
    outDir: input.outDir,
    sourceHash,
    counts: { spells: spells.length },
  };
}

function sha256Hex(bytes: Uint8Array | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
