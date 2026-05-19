import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModulePack } from './types.js';
import { WorldModuleError, validateModulePack } from './validate.js';

/** File name an authored module pack directory must contain. */
export const MODULE_FILE = 'module.json';

/** Parse and validate a module pack from a JSON string. */
export function parseModulePack(json: string): ModulePack {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (cause) {
    throw new WorldModuleError(
      `module JSON is not parseable: ${(cause as Error).message}`,
    );
  }
  return validateModulePack(value);
}

/**
 * Load the authored module pack at `<dir>/module.json`. The file is read
 * read-only and never written back, so the authored pack stays pristine and a
 * campaign can be re-forked from it.
 */
export function loadModuleFromDir(dir: string): ModulePack {
  const path = join(dir, MODULE_FILE);
  let json: string;
  try {
    json = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new WorldModuleError(
      `module pack not found at ${path}: ${(cause as Error).message}`,
    );
  }
  return parseModulePack(json);
}
