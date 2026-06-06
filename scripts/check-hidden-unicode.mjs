// Repo-wide guard against hidden / bidirectional Unicode control characters.
//
// GitHub renders a noisy "hidden or bidirectional Unicode text" warning on PR
// diffs that triggers on a broad range of Unicode content, so it is not a
// reliable manual signal. This check instead fails ONLY on the small set of
// genuinely dangerous invisible / directional control code points that can
// hide text or reorder how source is visually interpreted (e.g. the Trojan
// Source class of attacks). Benign visible Unicode punctuation — em dash (—),
// en dash (–), arrows (→), curly quotes (“ ”), degree sign (°), etc. — is
// allowed and never flagged.
//
// It scans only git-tracked text files (by extension) so build output,
// node_modules, and other ignored/vendored paths are never considered.
//
// Usage:
//   node scripts/check-hidden-unicode.mjs
// Exits non-zero and prints one diagnostic per finding when any forbidden
// character is present.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Forbidden code point -> Unicode name. Kept narrow on purpose: every entry is
// invisible or a directional/format control, not ordinary visible text.
export const FORBIDDEN_CODE_POINTS = new Map([
  // Bidi embedding / override controls (U+202A..U+202E).
  [0x202a, 'LEFT-TO-RIGHT EMBEDDING'],
  [0x202b, 'RIGHT-TO-LEFT EMBEDDING'],
  [0x202c, 'POP DIRECTIONAL FORMATTING'],
  [0x202d, 'LEFT-TO-RIGHT OVERRIDE'],
  [0x202e, 'RIGHT-TO-LEFT OVERRIDE'],
  // Bidi isolate controls (U+2066..U+2069).
  [0x2066, 'LEFT-TO-RIGHT ISOLATE'],
  [0x2067, 'RIGHT-TO-LEFT ISOLATE'],
  [0x2068, 'FIRST STRONG ISOLATE'],
  [0x2069, 'POP DIRECTIONAL ISOLATE'],
  // Zero-width characters and directional marks (U+200B..U+200F).
  [0x200b, 'ZERO WIDTH SPACE'],
  [0x200c, 'ZERO WIDTH NON-JOINER'],
  [0x200d, 'ZERO WIDTH JOINER'],
  [0x200e, 'LEFT-TO-RIGHT MARK'],
  [0x200f, 'RIGHT-TO-LEFT MARK'],
  // Other directional / invisible format controls.
  [0x061c, 'ARABIC LETTER MARK'],
  [0xfeff, 'ZERO WIDTH NO-BREAK SPACE (BYTE ORDER MARK)'],
  [0x00ad, 'SOFT HYPHEN'],
  [0x034f, 'COMBINING GRAPHEME JOINER'],
]);

// Text file extensions to scan. Anything else (binaries, fonts, PDFs, images)
// is skipped so we never decode non-text content as UTF-8.
export const SCANNED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.jsonc',
  '.md',
  '.ps1',
  '.yml',
  '.yaml',
  '.txt',
  '.sql',
]);

// Path prefixes never scanned even if a stray tracked file matched an
// extension. git ls-files already excludes ignored paths (node_modules, dist,
// local DBs, worktrees), so this is defense-in-depth. The generated SRD
// rules-packs under packages/core/data are intentionally NOT skipped: that is
// the path most likely to carry PDF-extracted SRD text, i.e. the exact class
// of hidden/bidi controls this gate exists to catch, so it is scanned as
// tracked text (Biome excludes it from formatting, but this check must not).
export const SKIPPED_PREFIXES = ['node_modules/', '.git/', 'dist/'];

function lowerExtension(path) {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const base = slash === -1 ? path : path.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

export function shouldScan(path) {
  const normalized = path.replace(/\\/g, '/');
  for (const prefix of SKIPPED_PREFIXES) {
    if (normalized === prefix || normalized.startsWith(prefix)) {
      return false;
    }
    if (normalized.includes(`/${prefix}`)) {
      return false;
    }
  }
  return SCANNED_EXTENSIONS.has(lowerExtension(normalized));
}

export function formatCodePoint(codePoint) {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

// Pure scanner: returns one finding per forbidden code point with 1-based line
// and column (counted in code points, so astral characters count as one).
export function scanContent(content) {
  const findings = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let column = 1;
    for (const ch of lines[i]) {
      const codePoint = ch.codePointAt(0);
      const name = FORBIDDEN_CODE_POINTS.get(codePoint);
      if (name !== undefined) {
        findings.push({ line: i + 1, column, codePoint, name });
      }
      column += 1;
    }
  }
  return findings;
}

export function formatFinding(path, finding) {
  return `${path}:${finding.line}:${finding.column}: forbidden hidden/bidi Unicode ${formatCodePoint(
    finding.codePoint,
  )} ${finding.name}`;
}

function listTrackedFiles() {
  const stdout = execFileSync('git', ['ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return stdout.split('\0').filter((entry) => entry !== '');
}

function main() {
  const files = listTrackedFiles().filter(shouldScan);
  const diagnostics = [];
  for (const file of files) {
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      // A tracked path that cannot be read as text (e.g. removed in the work
      // tree) is not our concern; skip it rather than fail the gate.
      continue;
    }
    for (const finding of scanContent(content)) {
      diagnostics.push(formatFinding(file, finding));
    }
  }

  if (diagnostics.length > 0) {
    process.stdout.write(`${diagnostics.join('\n')}\n`);
    process.stderr.write(
      `\nFound ${diagnostics.length} forbidden hidden/bidi Unicode character(s) in ${files.length} scanned file(s).\n` +
        'Visible Unicode punctuation (em dash, arrows, curly quotes, degree, etc.) is allowed; only invisible/bidirectional controls are blocked.\n',
    );
    process.exit(1);
  }

  process.stdout.write(
    `Scanned ${files.length} tracked text file(s); no forbidden hidden/bidi Unicode characters found.\n`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
