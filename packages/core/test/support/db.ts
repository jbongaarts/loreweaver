import { initSchema, openDatabase, startSession } from '../../src/index.js';
import type { Db } from '../../src/index.js';

export const DEFAULT_TEST_CAMPAIGN_ID = 'campaign-1';
export const DEFAULT_TEST_SESSION_ID = 'session-1';
export const DEFAULT_TEST_SESSION_STARTED_AT = '2026-05-20T09:00:00.000Z';

export interface FreshDbSessionOptions {
  campaignId?: string;
  sessionId?: string;
  startedAt?: string;
}

export function bareDb(): Db {
  const db = openDatabase(':memory:');
  initSchema(db);
  return db;
}

export function freshDbWithSession(options: FreshDbSessionOptions = {}): Db {
  const db = bareDb();
  startSession(db, {
    campaignId: options.campaignId ?? DEFAULT_TEST_CAMPAIGN_ID,
    sessionId: options.sessionId ?? DEFAULT_TEST_SESSION_ID,
    startedAt: options.startedAt ?? DEFAULT_TEST_SESSION_STARTED_AT,
  });
  return db;
}
