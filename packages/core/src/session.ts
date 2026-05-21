import type { Db } from './persistence/db.js';
import { withTransaction } from './persistence/db.js';

export type SessionStatus = 'open' | 'closed';

export interface SessionKey {
  campaignId: string;
  sessionId: string;
}

export interface CampaignSelector {
  campaignId: string;
}

export interface StartSessionInput extends SessionKey {
  startedAt: string;
}

export interface CloseSessionInput extends SessionKey {
  closedAt: string;
}

export interface SessionRecord extends SessionKey {
  status: SessionStatus;
  startedAt: string;
  closedAt: string | undefined;
}

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

export function startSession(db: Db, input: StartSessionInput): SessionRecord {
  requireFields('startSession', [
    ['campaignId', input.campaignId],
    ['sessionId', input.sessionId],
    ['startedAt', input.startedAt],
  ]);

  return withTransaction(db, (txnDb) => {
    const existingOpen = getOpenSession(txnDb, input);
    if (existingOpen !== undefined) {
      throw new SessionError(
        `session '${existingOpen.sessionId}' is still open in campaign '${input.campaignId}'; close it first`,
      );
    }
    if (getSession(txnDb, input) !== undefined) {
      throw new SessionError(
        `session '${input.sessionId}' already exists in campaign '${input.campaignId}'`,
      );
    }
    txnDb
      .prepare(
        `INSERT INTO campaign_session(
           campaign_id, session_id, status, started_at, closed_at
         )
         VALUES (?, ?, 'open', ?, NULL)`,
      )
      .run(input.campaignId, input.sessionId, input.startedAt);
    return {
      campaignId: input.campaignId,
      sessionId: input.sessionId,
      status: 'open',
      startedAt: input.startedAt,
      closedAt: undefined,
    };
  });
}

export function closeSession(db: Db, input: CloseSessionInput): SessionRecord {
  requireFields('closeSession', [
    ['campaignId', input.campaignId],
    ['sessionId', input.sessionId],
    ['closedAt', input.closedAt],
  ]);

  return withTransaction(db, (txnDb) => {
    const session = getSession(txnDb, input);
    if (session === undefined) {
      throw new SessionError(
        `cannot close unknown session '${input.sessionId}' in campaign '${input.campaignId}'`,
      );
    }
    if (session.status === 'closed') {
      return session;
    }
    txnDb
      .prepare(
        `UPDATE campaign_session
         SET status = 'closed', closed_at = ?
         WHERE campaign_id = ? AND session_id = ?`,
      )
      .run(input.closedAt, input.campaignId, input.sessionId);
    return { ...session, status: 'closed', closedAt: input.closedAt };
  });
}

export function getSession(
  db: Db,
  key: SessionKey,
): SessionRecord | undefined {
  const row = db
    .prepare(
      `SELECT campaign_id, session_id, status, started_at, closed_at
       FROM campaign_session
       WHERE campaign_id = ? AND session_id = ?`,
    )
    .get(key.campaignId, key.sessionId) as SessionRow | undefined;
  return row === undefined ? undefined : sessionFromRow(row);
}

export function getOpenSession(
  db: Db,
  selector: CampaignSelector,
): SessionRecord | undefined {
  const row = db
    .prepare(
      `SELECT campaign_id, session_id, status, started_at, closed_at
       FROM campaign_session
       WHERE campaign_id = ? AND status = 'open'
       ORDER BY started_at DESC, session_id DESC
       LIMIT 1`,
    )
    .get(selector.campaignId) as SessionRow | undefined;
  return row === undefined ? undefined : sessionFromRow(row);
}

export function listSessions(
  db: Db,
  selector: CampaignSelector,
): SessionRecord[] {
  const rows = db
    .prepare(
      `SELECT campaign_id, session_id, status, started_at, closed_at
       FROM campaign_session
       WHERE campaign_id = ?
       ORDER BY started_at ASC, session_id ASC`,
    )
    .all(selector.campaignId) as SessionRow[];
  return rows.map(sessionFromRow);
}

function requireFields(
  context: string,
  fields: ReadonlyArray<readonly [string, string]>,
): void {
  for (const [name, value] of fields) {
    if (value.length === 0) {
      throw new SessionError(`${context} ${name} is required`);
    }
  }
}

interface SessionRow {
  campaign_id: string;
  session_id: string;
  status: string;
  started_at: string;
  closed_at: string | null;
}

function sessionFromRow(row: SessionRow): SessionRecord {
  return {
    campaignId: row.campaign_id,
    sessionId: row.session_id,
    status: row.status as SessionStatus,
    startedAt: row.started_at,
    closedAt: row.closed_at ?? undefined,
  };
}
