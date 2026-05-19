import { describe, expect, it } from 'vitest';
import {
  initSchema,
  mutateState,
  openDatabase,
} from '../src/index.js';

describe('game state', () => {
  it('mutateState sets a character field with queryable provenance', () => {
    const db = openDatabase(':memory:');
    initSchema(db);

    mutateState(db, {
      target: 'character',
      field: 'name',
      op: 'set',
      value: 'Mira',
      provenance: 'player:session-zero',
      sessionId: 'session-1',
      at: '2026-05-19T04:00:00.000Z',
    });

    const row = db
      .prepare(
        `SELECT name, provenance, session_id, updated_at
         FROM character
         WHERE id = 1`,
      )
      .get() as
      | {
          name: string;
          provenance: string;
          session_id: string;
          updated_at: string;
        }
      | undefined;

    expect(row).toEqual({
      name: 'Mira',
      provenance: 'player:session-zero',
      session_id: 'session-1',
      updated_at: '2026-05-19T04:00:00.000Z',
    });

    db.close();
  });
});
