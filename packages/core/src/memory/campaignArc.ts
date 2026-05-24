import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import type { ArcSummaryRecord } from './summary.js';
import { jsonColumn } from '../persistence/jsonColumn.js';

export interface CampaignArcRecord {
  campaignId: string;
  arcId: string;
  sequenceNo: number;
  status: 'open' | 'closed';
  openedAt: string;
  closedAt: string | undefined;
}

export interface OpenArcIfMissingInput {
  campaignId: string;
  now: string;
}

export interface CampaignSessionInArc {
  sessionId: string;
  closedAt: string;
}

interface CampaignArcRow {
  campaign_id: string;
  arc_id: string;
  sequence_no: number;
  status: string;
  opened_at: string;
  closed_at: string | null;
}

interface CampaignSessionInArcRow {
  session_id: string;
  closed_at: string;
}

interface ArcSummaryRow {
  campaign_id: string;
  arc_id: string;
  summary: string;
  source_session_ids_json: string;
  created_at: string;
  updated_at: string;
}

const arcColumns = {
  sourceSessionIds: jsonColumn<string[]>('arc_summary.source_session_ids'),
};

function arcRecordFromRow(row: CampaignArcRow): CampaignArcRecord {
  return {
    campaignId: row.campaign_id,
    arcId: row.arc_id,
    sequenceNo: row.sequence_no,
    status: row.status as 'open' | 'closed',
    openedAt: row.opened_at,
    closedAt: row.closed_at ?? undefined,
  };
}

function arcSummaryFromRow(row: ArcSummaryRow): ArcSummaryRecord {
  return {
    campaignId: row.campaign_id,
    arcId: row.arc_id,
    summary: row.summary,
    sourceSessionIds: arcColumns.sourceSessionIds.decode(
      row.source_session_ids_json,
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Ensures an open arc exists for the campaign, creating one if absent.
 * Idempotent: if an open arc already exists, it is returned unchanged.
 * The sequence_no is computed as MAX(sequence_no) + 1 across all arcs
 * for the campaign, so arc-1, arc-2, etc. follow naturally.
 */
export function openArcIfMissing(
  db: Db,
  input: OpenArcIfMissingInput,
): CampaignArcRecord {
  return withTransaction(db, (txnDb) => {
    const existing = getOpenArc(txnDb, { campaignId: input.campaignId });
    if (existing !== undefined) {
      return existing;
    }

    const seqRow = txnDb
      .prepare(
        `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next_seq
         FROM campaign_arc
         WHERE campaign_id = ?`,
      )
      .get(input.campaignId) as { next_seq: number };

    const sequenceNo = seqRow.next_seq;
    const arcId = `arc-${sequenceNo}`;

    txnDb
      .prepare(
        `INSERT INTO campaign_arc(campaign_id, arc_id, sequence_no, status, opened_at, closed_at)
         VALUES (?, ?, ?, 'open', ?, NULL)`,
      )
      .run(input.campaignId, arcId, sequenceNo, input.now);

    return {
      campaignId: input.campaignId,
      arcId,
      sequenceNo,
      status: 'open',
      openedAt: input.now,
      closedAt: undefined,
    };
  });
}

/**
 * Returns the open arc for the campaign, or undefined if none exists.
 */
export function getOpenArc(
  db: Db,
  key: { campaignId: string },
): CampaignArcRecord | undefined {
  const row = db
    .prepare(
      `SELECT campaign_id, arc_id, sequence_no, status, opened_at, closed_at
       FROM campaign_arc
       WHERE campaign_id = ? AND status = 'open'`,
    )
    .get(key.campaignId) as CampaignArcRow | undefined;
  return row === undefined ? undefined : arcRecordFromRow(row);
}

/**
 * Returns the count of closed arcs for the campaign.
 */
export function getClosedArcCount(
  db: Db,
  key: { campaignId: string },
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM campaign_arc
       WHERE campaign_id = ? AND status = 'closed'`,
    )
    .get(key.campaignId) as { count: number };
  return row.count;
}

/**
 * Returns the closed sessions that are stamped with the campaign's open arc,
 * sorted by closed_at ASC. Returns an empty array if no open arc exists.
 */
export function getClosedSessionsInOpenArc(
  db: Db,
  key: { campaignId: string },
): CampaignSessionInArc[] {
  const rows = db
    .prepare(
      `SELECT cs.session_id, cs.closed_at
       FROM campaign_session cs
       INNER JOIN campaign_arc ca
         ON ca.campaign_id = cs.campaign_id
         AND ca.arc_id = cs.arc_id
         AND ca.status = 'open'
       WHERE cs.campaign_id = ?
         AND cs.status = 'closed'
       ORDER BY cs.closed_at ASC`,
    )
    .all(key.campaignId) as CampaignSessionInArcRow[];
  return rows.map((row) => ({
    sessionId: row.session_id,
    closedAt: row.closed_at,
  }));
}

/**
 * Stamps the given session with the campaign's open arc_id.
 * Throws if no open arc exists — caller must call openArcIfMissing first.
 */
export function stampSessionWithOpenArc(
  db: Db,
  key: { campaignId: string; sessionId: string },
): void {
  const openArc = getOpenArc(db, { campaignId: key.campaignId });
  if (openArc === undefined) {
    throw new Error(
      `stampSessionWithOpenArc: no open arc exists for campaign '${key.campaignId}'; call openArcIfMissing first`,
    );
  }
  db.prepare(
    `UPDATE campaign_session
     SET arc_id = ?
     WHERE campaign_id = ? AND session_id = ?`,
  ).run(openArc.arcId, key.campaignId, key.sessionId);
}

/**
 * Returns arc summaries for all closed arcs in the campaign, joined against
 * campaign_arc to order by sequence_no ASC. Open arcs are excluded.
 */
export function listClosedArcSummaries(
  db: Db,
  key: { campaignId: string },
): ArcSummaryRecord[] {
  const rows = db
    .prepare(
      `SELECT
         ars.campaign_id,
         ars.arc_id,
         ars.summary,
         ars.source_session_ids_json,
         ars.created_at,
         ars.updated_at
       FROM arc_summary ars
       INNER JOIN campaign_arc ca
         ON ca.campaign_id = ars.campaign_id
         AND ca.arc_id = ars.arc_id
       WHERE ars.campaign_id = ?
         AND ca.status = 'closed'
       ORDER BY ca.sequence_no ASC`,
    )
    .all(key.campaignId) as ArcSummaryRow[];
  return rows.map(arcSummaryFromRow);
}
