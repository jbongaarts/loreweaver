import type { Db } from '../persistence/db.js';

const ACTIVE_CHARACTER_KEY = 'active_character_id';

export class NoActiveCharacterError extends Error {
  constructor() {
    super('no active character is set');
    this.name = 'NoActiveCharacterError';
  }
}

export function getActiveCharacterId(db: Db): string {
  const row = db
    .prepare('SELECT value FROM meta WHERE key = ?')
    .get(ACTIVE_CHARACTER_KEY) as { value: string } | undefined;
  if (row === undefined) {
    throw new NoActiveCharacterError();
  }
  return row.value;
}

export function tryGetActiveCharacterId(db: Db): string | undefined {
  const row = db
    .prepare('SELECT value FROM meta WHERE key = ?')
    .get(ACTIVE_CHARACTER_KEY) as { value: string } | undefined;
  return row?.value;
}

export function setActiveCharacterId(db: Db, characterId: string): void {
  db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run(
    ACTIVE_CHARACTER_KEY,
    characterId,
  );
}

export function resolveCharacterId(db: Db, explicitId?: string): string {
  if (explicitId !== undefined) {
    return explicitId;
  }
  return getActiveCharacterId(db);
}
