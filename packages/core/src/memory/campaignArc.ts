import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import type { ArcSummaryRecord, CampaignBibleInput } from './summary.js';
import { rollupArcSummary } from './summary.js';
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
export function getClosedArcCount(db: Db, key: { campaignId: string }): number {
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

export interface CloseOpenArcAndOpenNextInput {
  campaignId: string;
  /** Expected open-arc id; throws if the actual open arc does not match. */
  arcId: string;
  /** Arc-summary text. */
  summary: string;
  /** Sessions rolled into the summary. */
  sourceSessionIds: string[];
  /** Updated campaign bible written via rollupArcSummary. */
  campaignBible: CampaignBibleInput;
  now: string;
}

export interface CloseOpenArcAndOpenNextResult {
  closedArcId: string;
  newArcId: string;
}

/**
 * Atomically closes the current open arc and opens the next one.
 *
 * In a single transaction:
 *   1. Verifies the open arc matches `input.arcId` (throws on mismatch).
 *   2. Calls `rollupArcSummary` to write the `arc_summary` row and reconcile
 *      the campaign bible.
 *   3. Updates `campaign_arc` setting `status='closed'`, `closed_at=now`.
 *   4. Inserts the new open arc (`arc-{sequenceNo+1}`).
 *
 * The partial unique index on `campaign_arc(campaign_id) WHERE status='open'`
 * guarantees that no two open arcs can exist simultaneously; if step 4 fails
 * the whole transaction rolls back.
 */
export function closeOpenArcAndOpenNext(
  db: Db,
  input: CloseOpenArcAndOpenNextInput,
): CloseOpenArcAndOpenNextResult {
  return withTransaction(db, (txnDb) => {
    // Step 1: verify the open arc matches the caller's expectation.
    const openArc = getOpenArc(txnDb, { campaignId: input.campaignId });
    if (openArc === undefined || openArc.arcId !== input.arcId) {
      const actual = openArc === undefined ? '(none)' : `'${openArc.arcId}'`;
      throw new Error(
        `closeOpenArcAndOpenNext: expected open arc '${input.arcId}' for campaign '${input.campaignId}' but found ${actual}`,
      );
    }

    // Step 2: write the arc_summary row and reconcile the campaign bible.
    rollupArcSummary(txnDb, {
      campaignId: input.campaignId,
      arcId: input.arcId,
      summary: input.summary,
      sourceSessionIds: input.sourceSessionIds,
      campaignBible: input.campaignBible,
      createdAt: input.now,
    });

    // Step 3: mark the current arc as closed. Step 1's open-arc verification
    // runs inside the same transaction, so the row is guaranteed present and
    // changes === 1; the assert is a guard against future refactors that move
    // the verification out of the transaction.
    const closeInfo = txnDb
      .prepare(
        `UPDATE campaign_arc
         SET status = 'closed', closed_at = ?
         WHERE campaign_id = ? AND arc_id = ?`,
      )
      .run(input.now, input.campaignId, input.arcId);
    if (closeInfo.changes !== 1) {
      throw new Error(
        `closeOpenArcAndOpenNext: expected to close exactly 1 row for arc '${input.arcId}' in campaign '${input.campaignId}' but updated ${closeInfo.changes}`,
      );
    }

    // Step 4: insert the new open arc.
    const nextSequenceNo = openArc.sequenceNo + 1;
    const newArcId = `arc-${nextSequenceNo}`;
    txnDb
      .prepare(
        `INSERT INTO campaign_arc(campaign_id, arc_id, sequence_no, status, opened_at, closed_at)
         VALUES (?, ?, ?, 'open', ?, NULL)`,
      )
      .run(input.campaignId, newArcId, nextSequenceNo, input.now);

    return { closedArcId: input.arcId, newArcId };
  });
}
