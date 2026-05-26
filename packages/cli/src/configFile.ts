/**
 * Non-secret CLI config file (`<root>/config.json`, ADR 0004).
 *
 * The config file holds per-user preferences only — never provider
 * credentials. It is JSON to avoid a parser dependency and to match
 * `registry.json`.
 *
 * Settings precedence, highest wins:
 *
 *   explicit CLI flag  >  environment variable  >  config.json  >  default
 *
 * This module loads and validates the file and exposes {@link applyConfigToEnv},
 * which overlays the config file's environment-equivalent keys onto an
 * environment map *only where the variable is unset* — so an environment
 * variable always outranks the config file. Core resolvers (`loadConfig`,
 * `resolveDoltBinary`, `resolveProfileRegistry`) already accept an injected
 * environment, so feeding them the overlaid map is all the wiring precedence
 * needs.
 */

import { readFileSync } from 'node:fs';
import { configFilePath } from './dataRoot.js';

type Env = Record<string, string | undefined>;

/** Thrown for an unreadable, malformed, or secret-bearing config file. */
export class ConfigFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigFileError';
  }
}

/** A per-profile model override, mirroring `LOREWEAVER_PROFILE_<NAME>_*`. */
export interface ConfigProfileOverride {
  provider?: string;
  model?: string;
}

/** The recognized, non-secret shape of `config.json`. Every key is optional. */
export interface CliConfigFile {
  /** Campaign opened by `play` when none is named (a registry campaign id). */
  defaultCampaignId?: string;
  /** Managed Dolt cache directory — equivalent of `LOREWEAVER_DOLT_HOME`. */
  doltHome?: string;
  /** Explicit Dolt binary path — equivalent of `LOREWEAVER_DOLT_BIN`. */
  doltBin?: string;
  /** Model profile overrides, keyed by profile name (e.g. `premium_dm`). */
  profiles?: Record<string, ConfigProfileOverride>;
}

/**
 * Keys whose name alone marks a secret. A config file is non-secret by
 * contract, so any of these is rejected outright rather than silently ignored.
 */
const SECRET_KEY_NAME = /(api[_-]?key|secret|password|token|credential)/i;

/**
 * Value shapes that look like a provider credential. The config file must
 * never carry one (ADR 0002 keeps secrets in the environment), so a matching
 * value fails loud instead of being persisted to disk.
 */
const SECRET_VALUE = [
  /sk-ant-/i, // Anthropic Console API key
  /\bsk-[A-Za-z0-9_-]{16,}/, // generic `sk-` provider key
];

/** Recursively reject secret-named keys and credential-shaped string values. */
function assertNoSecrets(value: unknown, path: string): void {
  if (typeof value === 'string') {
    for (const pattern of SECRET_VALUE) {
      if (pattern.test(value)) {
        throw new ConfigFileError(
          `config.json must not contain secrets: ${path} looks like a provider API key. Keep credentials in the environment (ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN), not config.json.`,
        );
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoSecrets(item, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_KEY_NAME.test(key)) {
        throw new ConfigFileError(
          `config.json must not contain secrets: the key '${key}' (at ${path}) is not allowed. Keep credentials in the environment, not config.json.`,
        );
      }
      assertNoSecrets(child, path === '' ? key : `${path}.${key}`);
    }
  }
}

function asString(value: unknown, key: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ConfigFileError(`config.json: '${key}' must be a string`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asProfiles(
  value: unknown,
): Record<string, ConfigProfileOverride> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigFileError("config.json: 'profiles' must be an object");
  }
  const profiles: Record<string, ConfigProfileOverride> = {};
  for (const [name, raw] of Object.entries(value)) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new ConfigFileError(
        `config.json: profile '${name}' must be an object`,
      );
    }
    const entry = raw as Record<string, unknown>;
    profiles[name] = {
      provider: asString(entry.provider, `profiles.${name}.provider`),
      model: asString(entry.model, `profiles.${name}.model`),
    };
  }
  return profiles;
}

/**
 * Load and validate `<root>/config.json`. A missing file is not an error — it
 * yields an empty config. A malformed file, an unexpected field type, or any
 * secret-shaped content throws {@link ConfigFileError}.
 */
export function loadConfigFile(
  root: string,
  readFile: (path: string) => string = (p) => readFileSync(p, 'utf8'),
): CliConfigFile {
  const path = configFilePath(root);
  let raw: string;
  try {
    raw = readFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw new ConfigFileError(`cannot read ${path}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigFileError(
      `${path} is not valid JSON: ${(err as Error).message}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ConfigFileError(`${path} must contain a JSON object`);
  }

  assertNoSecrets(parsed, '');

  const obj = parsed as Record<string, unknown>;
  return {
    defaultCampaignId: asString(obj.defaultCampaignId, 'defaultCampaignId'),
    doltHome: asString(obj.doltHome, 'doltHome'),
    doltBin: asString(obj.doltBin, 'doltBin'),
    profiles: asProfiles(obj.profiles),
  };
}

/** Set `key` on `env` only when it is currently unset or blank. */
function fillIfUnset(env: Env, key: string, value: string | undefined): void {
  if (value && !env[key]?.trim()) {
    env[key] = value;
  }
}

/**
 * Overlay a {@link CliConfigFile}'s environment-equivalent settings onto a copy
 * of `env`, filling only keys that are unset. The result feeds core resolvers
 * so that an environment variable wins over `config.json`, which wins over the
 * built-in default. `defaultCampaignId` has no environment equivalent and is
 * not overlaid — the campaign picker consumes it directly.
 */
export function applyConfigToEnv(env: Env, config: CliConfigFile): Env {
  const merged: Env = { ...env };
  fillIfUnset(merged, 'LOREWEAVER_DOLT_HOME', config.doltHome);
  fillIfUnset(merged, 'LOREWEAVER_DOLT_BIN', config.doltBin);
  for (const [name, override] of Object.entries(config.profiles ?? {})) {
    const upper = name.toUpperCase();
    fillIfUnset(
      merged,
      `LOREWEAVER_PROFILE_${upper}_PROVIDER`,
      override.provider,
    );
    fillIfUnset(merged, `LOREWEAVER_PROFILE_${upper}_MODEL`, override.model);
  }
  return merged;
}

/**
 * Apply the config file's environment-equivalent settings to `env` in place,
 * filling only keys that are unset. The CLI calls this once at startup so that
 * core resolvers reading ambient `process.env` (Dolt resolution, the profile
 * registry) honor `config.json` while still letting a real environment
 * variable win. Returns nothing — the mutation is the point.
 */
export function installConfigDefaults(
  config: CliConfigFile,
  env: Env = process.env,
): void {
  const merged = applyConfigToEnv(env, config);
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && env[key] === undefined) {
      env[key] = value;
    }
  }
}
