/**
 * Campaign registry (`<root>/registry.json`, ADR 0004).
 *
 * The registry is a small index of the campaigns the CLI manages. Each entry
 * is pointer metadata only — id, display name, database path, timestamps, and
 * the module/rules-pack identity — never campaign content and never secrets.
 *
 * It is written with the atomic temp-file-plus-rename pattern, so a crash
 * mid-write cannot leave a half-written `registry.json`.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { registryFilePath } from './dataRoot.js';

/** Current `registry.json` schema version. */
export const REGISTRY_VERSION = 1;

/** One managed campaign — pointer metadata only. */
export interface CampaignRegistryEntry {
  /** Stable slug; unique within the registry. */
  id: string;
  /** Human-facing display name. */
  name: string;
  /** Absolute path to the campaign SQLite database. */
  dbPath: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp of the most recent `play`, if ever played. */
  lastPlayedAt?: string;
  /** Module / rules-pack identity the campaign was created from. */
  module?: string;
}

/** The whole registry file. */
export interface CampaignRegistry {
  version: number;
  campaigns: CampaignRegistryEntry[];
}

/** Thrown for an unreadable or malformed `registry.json`. */
export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

/** An empty registry, used when no file exists yet. */
export function emptyRegistry(): CampaignRegistry {
  return { version: REGISTRY_VERSION, campaigns: [] };
}

function isEntry(value: unknown): value is CampaignRegistryEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    typeof e.name === 'string' &&
    typeof e.dbPath === 'string' &&
    typeof e.createdAt === 'string' &&
    (e.lastPlayedAt === undefined || typeof e.lastPlayedAt === 'string') &&
    (e.module === undefined || typeof e.module === 'string')
  );
}

/**
 * Load and validate `<root>/registry.json`. A missing file is not an error —
 * it yields {@link emptyRegistry}. A malformed file throws {@link RegistryError}.
 */
export function loadRegistry(
  root: string,
  readFile: (path: string) => string = (p) => readFileSync(p, 'utf8'),
): CampaignRegistry {
  const path = registryFilePath(root);
  let raw: string;
  try {
    raw = readFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyRegistry();
    }
    throw new RegistryError(`cannot read ${path}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new RegistryError(
      `${path} is not valid JSON: ${(err as Error).message}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new RegistryError(`${path} must contain a JSON object`);
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.campaigns) || !obj.campaigns.every(isEntry)) {
    throw new RegistryError(`${path}: 'campaigns' must be an array of entries`);
  }
  return {
    version: typeof obj.version === 'number' ? obj.version : REGISTRY_VERSION,
    campaigns: obj.campaigns,
  };
}

/**
 * Write the registry to `<root>/registry.json` atomically: serialize to a
 * uniquely-named sibling temp file, then rename it over the destination. The
 * rename is atomic on POSIX and replaces the destination on Windows, so a
 * reader never observes a partial file.
 */
export function saveRegistry(
  root: string,
  registry: CampaignRegistry,
  write: (path: string, data: string) => void = (p, d) =>
    writeFileSync(p, d, 'utf8'),
  rename: (from: string, to: string) => void = renameSync,
): void {
  const path = registryFilePath(root);
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  const data = `${JSON.stringify(registry, null, 2)}\n`;
  write(tmp, data);
  rename(tmp, path);
}

/** Reduce a display name to a registry slug. */
export function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'campaign';
}

/** Derive a slug from `name` that does not collide with an existing id. */
export function uniqueId(name: string, registry: CampaignRegistry): string {
  const base = slugify(name);
  const taken = new Set(registry.campaigns.map((c) => c.id));
  if (!taken.has(base)) {
    return base;
  }
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

/** Find an entry by exact id, or `undefined`. */
export function findCampaign(
  registry: CampaignRegistry,
  id: string,
): CampaignRegistryEntry | undefined {
  return registry.campaigns.find((c) => c.id === id);
}

/** Return a registry with `entry` appended; throws on a duplicate id. */
export function addCampaign(
  registry: CampaignRegistry,
  entry: CampaignRegistryEntry,
): CampaignRegistry {
  if (findCampaign(registry, entry.id)) {
    throw new RegistryError(`a campaign with id '${entry.id}' already exists`);
  }
  return { ...registry, campaigns: [...registry.campaigns, entry] };
}

/** Return a registry with the entry `id` removed; throws if it is absent. */
export function removeCampaign(
  registry: CampaignRegistry,
  id: string,
): CampaignRegistry {
  if (!findCampaign(registry, id)) {
    throw new RegistryError(`no campaign with id '${id}'`);
  }
  return {
    ...registry,
    campaigns: registry.campaigns.filter((c) => c.id !== id),
  };
}

/** Return a registry where `id`'s entry is replaced via `update`. */
export function updateCampaign(
  registry: CampaignRegistry,
  id: string,
  update: (entry: CampaignRegistryEntry) => CampaignRegistryEntry,
): CampaignRegistry {
  if (!findCampaign(registry, id)) {
    throw new RegistryError(`no campaign with id '${id}'`);
  }
  return {
    ...registry,
    campaigns: registry.campaigns.map((c) => (c.id === id ? update(c) : c)),
  };
}
