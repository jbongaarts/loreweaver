import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute, join } from 'node:path';

export const BEADS_RESERVED_REF = 'refs/dolt/data';
/** The whole namespace beads syncs through; campaigns must never touch it. */
const BEADS_RESERVED_REF_NS = 'refs/dolt/';

export class SeparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeparationError';
  }
}

export interface DoltRemote {
  name: string;
  url: string;
  fetchSpecs: string[];
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Canonical form so trailing slash / `.git` / case differences still collide. */
export function normalizeRemoteUrl(url: string): string {
  return url
    .trim()
    .replace(/(?<!\/)\/+$/, '')
    .replace(/\.git$/i, '')
    .toLowerCase();
}

/**
 * Pure read of a Dolt repo's configured remotes from
 * `<doltDir>/.dolt/repo_state.json`. No `dolt` binary, no network — returns
 * `[]` when the repo is uninitialized or has no remotes.
 */
export function readDoltRemotes(doltDir: string): DoltRemote[] {
  const f = join(resolve(doltDir), '.dolt', 'repo_state.json');
  let raw: string;
  try {
    if (!existsSync(f) || !statSync(f).isFile()) return [];
    raw = readFileSync(f, 'utf8');
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const remotes = (
    parsed as {
      remotes?: Record<
        string,
        { name?: string; url?: string; fetch_specs?: unknown }
      >;
    }
  ).remotes;
  if (!remotes || typeof remotes !== 'object') return [];
  return Object.values(remotes)
    .filter(
      (r): r is { name?: string; url?: string; fetch_specs?: unknown } =>
        !!r && typeof r === 'object',
    )
    .map((r) => ({
      name: String(r.name ?? ''),
      url: String(r.url ?? ''),
      fetchSpecs: Array.isArray(r.fetch_specs)
        ? r.fetch_specs.map((s) => String(s))
        : [],
    }))
    .filter((r) => r.url !== '');
}

function touchesBeadsRefNamespace(specs: string[]): boolean {
  return specs.some((spec) =>
    spec.split(':').some((side) => side.startsWith(BEADS_RESERVED_REF_NS)),
  );
}

/**
 * Reject a campaign Dolt location that is not fully disjoint from the beads
 * Dolt repo. Three independent checks (epic acceptance #5):
 *  1. filesystem: equal / nested either direction;
 *  2. remote URL: campaign shares a normalized remote URL with beads;
 *  3. ref namespace: a campaign remote fetch spec touches `refs/dolt/*`
 *     (the namespace beads syncs through — `BEADS_RESERVED_REF`).
 * Pure + offline.
 */
export function assertSeparateFromBeads(
  doltDir: string,
  beadsDir: string,
): void {
  const a = resolve(doltDir);
  const b = resolve(beadsDir);
  if (a === b || isInside(a, b) || isInside(b, a)) {
    throw new SeparationError(
      `Loreweaver Dolt dir ${a} must be disjoint from beads Dolt dir ${b}`,
    );
  }

  const campaignRemotes = readDoltRemotes(a);
  const beadsUrls = new Set(
    readDoltRemotes(b).map((r) => normalizeRemoteUrl(r.url)),
  );

  for (const remote of campaignRemotes) {
    if (beadsUrls.has(normalizeRemoteUrl(remote.url))) {
      throw new SeparationError(
        `Loreweaver Dolt remote "${remote.name}" (${remote.url}) collides ` +
          `with a beads Dolt remote; campaign history must not share a remote ` +
          `with beads.`,
      );
    }
    if (touchesBeadsRefNamespace(remote.fetchSpecs)) {
      throw new SeparationError(
        `Loreweaver Dolt remote "${remote.name}" uses the beads-reserved ref ` +
          `namespace (${BEADS_RESERVED_REF_NS}* / ${BEADS_RESERVED_REF}).`,
      );
    }
  }
}
