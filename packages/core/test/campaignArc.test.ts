import { beforeEach, describe, expect, it } from 'vitest';
import {
  initSchema,
  openDatabase,
  openArcIfMissing,
  getOpenArc,
  getClosedArcCount,
  getClosedSessionsInOpenArc,
  stampSessionWithOpenArc,
  listClosedArcSummaries,
  startSession,
  closeSession,
  rollupArcSummary,
  type CampaignArcRecord,
} from '../src/internal.js';
import type { Db } from '../src/persistence/db.js';

function makeDb(): Db {
  const db = openDatabase(':memory:');
  initSchema(db);
  return db;
}

describe('openArcIfMissing', () => {
  it('creates arc-1 with sequence_no=1 on first call', () => {
    const db = makeDb();
    const arc = openArcIfMissing(db, {
      campaignId: 'c1',
      now: '2026-01-01T00:00:00Z',
    });
    expect(arc).toEqual<CampaignArcRecord>({
      campaignId: 'c1',
      arcId: 'arc-1',
      sequenceNo: 1,
      status: 'open',
      openedAt: '2026-01-01T00:00:00Z',
      closedAt: undefined,
    });
    db.close();
  });

  it('is idempotent: returns the existing open arc on subsequent calls', () => {
    const db = makeDb();
    const first = openArcIfMissing(db, {
      campaignId: 'c1',
      now: '2026-01-01T00:00:00Z',
    });
    const second = openArcIfMissing(db, {
      campaignId: 'c1',
      now: '2026-02-01T00:00:00Z',
    });
    expect(second).toEqual(first);
    expect(second.openedAt).toBe('2026-01-01T00:00:00Z');
    db.close();
  });

  it('creates arc-2 after arc-1 is manually closed', () => {
    const db = makeDb();
    openArcIfMissing(db, { campaignId: 'c1', now: '2026-01-01T00:00:00Z' });
    // Manually flip arc-1 to closed so the partial unique index allows a new open arc
    db.prepare(
      `UPDATE campaign_arc SET status = 'closed', closed_at = ? WHERE campaign_id = ? AND arc_id = ?`,
    ).run('2026-02-01T00:00:00Z', 'c1', 'arc-1');
    const arc2 = openArcIfMissing(db, {
      campaignId: 'c1',
      now: '2026-02-02T00:00:00Z',
    });
    expect(arc2.arcId).toBe('arc-2');
    expect(arc2.sequenceNo).toBe(2);
    expect(arc2.status).toBe('open');
    db.close();
  });
});

describe('getOpenArc', () => {
  it('returns undefined when no arc exists', () => {
    const db = makeDb();
    expect(getOpenArc(db, { campaignId: 'c1' })).toBeUndefined();
    db.close();
  });

  it('returns the open arc when one exists', () => {
    const db = makeDb();
    const created = openArcIfMissing(db, {
      campaignId: 'c1',
      now: '2026-01-01T00:00:00Z',
    });
    const found = getOpenArc(db, { campaignId: 'c1' });
    expect(found).toEqual(created);
    db.close();
  });

  it('returns undefined after the arc is manually closed', () => {
    const db = makeDb();
    openArcIfMissing(db, { campaignId: 'c1', now: '2026-01-01T00:00:00Z' });
    db.prepare(
      `UPDATE campaign_arc SET status = 'closed', closed_at = ? WHERE campaign_id = ?`,
    ).run('2026-02-01T00:00:00Z', 'c1');
    expect(getOpenArc(db, { campaignId: 'c1' })).toBeUndefined();
    db.close();
  });
});

describe('getClosedArcCount', () => {
  it('returns 0 when no arcs exist', () => {
    const db = makeDb();
    expect(getClosedArcCount(db, { campaignId: 'c1' })).toBe(0);
    db.close();
  });

  it('returns 0 when only an open arc exists', () => {
    const db = makeDb();
    openArcIfMissing(db, { campaignId: 'c1', now: '2026-01-01T00:00:00Z' });
    expect(getClosedArcCount(db, { campaignId: 'c1' })).toBe(0);
    db.close();
  });

  it('counts only closed arcs', () => {
    const db = makeDb();
    // Open arc-1
    openArcIfMissing(db, { campaignId: 'c1', now: '2026-01-01T00:00:00Z' });
    // Manually close arc-1
    db.prepare(
      `UPDATE campaign_arc SET status = 'closed', closed_at = ? WHERE campaign_id = ? AND arc_id = ?`,
    ).run('2026-02-01T00:00:00Z', 'c1', 'arc-1');
    // Open arc-2
    openArcIfMissing(db, { campaignId: 'c1', now: '2026-02-02T00:00:00Z' });
    // Only arc-1 is closed; arc-2 is still open
    expect(getClosedArcCount(db, { campaignId: 'c1' })).toBe(1);
    db.close();
  });
});

describe('getClosedSessionsInOpenArc', () => {
  it('returns empty when no open arc exists', () => {
    const db = makeDb();
    expect(
      getClosedSessionsInOpenArc(db, { campaignId: 'c1' }),
    ).toEqual([]);
    db.close();
  });

  it('returns empty when open arc has no stamped closed sessions', () => {
    const db = makeDb();
    openArcIfMissing(db, { campaignId: 'c1', now: '2026-01-01T00:00:00Z' });
    expect(
      getClosedSessionsInOpenArc(db, { campaignId: 'c1' }),
    ).toEqual([]);
    db.close();
  });

  it('returns closed sessions stamped with the open arc, sorted by closed_at', () => {
    const db = makeDb();
    openArcIfMissing(db, { campaignId: 'c1', now: '2026-01-01T00:00:00Z' });

    // Insert two closed sessions with arc_id stamped
    db.prepare(
      `INSERT INTO campaign_session(campaign_id, session_id, status, started_at, closed_at, arc_id)
       VALUES (?, ?, 'closed', ?, ?, ?)`,
    ).run('c1', 's2', '2026-01-02T00:00:00Z', '2026-01-02T12:00:00Z', 'arc-1');
    db.prepare(
      `INSERT INTO campaign_session(campaign_id, session_id, status, started_at, closed_at, arc_id)
       VALUES (?, ?, 'closed', ?, ?, ?)`,
    ).run('c1', 's1', '2026-01-01T00:00:00Z', '2026-01-01T12:00:00Z', 'arc-1');

    const sessions = getClosedSessionsInOpenArc(db, { campaignId: 'c1' });
    expect(sessions).toHaveLength(2);
    // Should be sorted by closed_at ASC
    expect(sessions[0]).toEqual({
      sessionId: 's1',
      closedAt: '2026-01-01T12:00:00Z',
    });
    expect(sessions[1]).toEqual({
      sessionId: 's2',
      closedAt: '2026-01-02T12:00:00Z',
    });
    db.close();
  });

  it('does not include sessions from other arcs', () => {
    const db = makeDb();
    openArcIfMissing(db, { campaignId: 'c1', now: '2026-01-01T00:00:00Z' });

    // Session stamped with a different arc_id
    db.prepare(
      `INSERT INTO campaign_session(campaign_id, session_id, status, started_at, closed_at, arc_id)
       VALUES (?, ?, 'closed', ?, ?, ?)`,
    ).run('c1', 's-other', '2026-01-01T00:00:00Z', '2026-01-01T12:00:00Z', 'arc-0');
    // Session stamped with open arc
    db.prepare(
      `INSERT INTO campaign_session(campaign_id, session_id, status, started_at, closed_at, arc_id)
       VALUES (?, ?, 'closed', ?, ?, ?)`,
    ).run('c1', 's-current', '2026-01-02T00:00:00Z', '2026-01-02T12:00:00Z', 'arc-1');

    const sessions = getClosedSessionsInOpenArc(db, { campaignId: 'c1' });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe('s-current');
    db.close();
  });
});

describe('stampSessionWithOpenArc', () => {
  it('sets campaign_session.arc_id to the open arc', () => {
    const db = makeDb();
    openArcIfMissing(db, { campaignId: 'c1', now: '2026-01-01T00:00:00Z' });
    startSession(db, {
      campaignId: 'c1',
      sessionId: 's1',
      startedAt: '2026-01-01T01:00:00Z',
    });
    stampSessionWithOpenArc(db, { campaignId: 'c1', sessionId: 's1' });

    const row = db
      .prepare(
        `SELECT arc_id FROM campaign_session WHERE campaign_id = ? AND session_id = ?`,
      )
      .get('c1', 's1') as { arc_id: string | null };
    expect(row.arc_id).toBe('arc-1');
    db.close();
  });

  it('throws if no open arc exists', () => {
    const db = makeDb();
    startSession(db, {
      campaignId: 'c1',
      sessionId: 's1',
      startedAt: '2026-01-01T01:00:00Z',
    });
    expect(() =>
      stampSessionWithOpenArc(db, { campaignId: 'c1', sessionId: 's1' }),
    ).toThrow();
    db.close();
  });
});

describe('listClosedArcSummaries', () => {
  it('returns empty when no arcs exist', () => {
    const db = makeDb();
    expect(listClosedArcSummaries(db, { campaignId: 'c1' })).toEqual([]);
    db.close();
  });

  it('returns closed arcs in sequence_no order', () => {
    const db = makeDb();
    // Manually insert two closed arcs in reverse order so ordering matters
    db.prepare(
      `INSERT INTO campaign_arc(campaign_id, arc_id, sequence_no, status, opened_at, closed_at)
       VALUES (?, ?, ?, 'closed', ?, ?)`,
    ).run('c1', 'arc-2', 2, '2026-02-01T00:00:00Z', '2026-03-01T00:00:00Z');
    db.prepare(
      `INSERT INTO campaign_arc(campaign_id, arc_id, sequence_no, status, opened_at, closed_at)
       VALUES (?, ?, ?, 'closed', ?, ?)`,
    ).run('c1', 'arc-1', 1, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');

    // Insert arc_summary rows for both
    rollupArcSummary(db, {
      campaignId: 'c1',
      arcId: 'arc-2',
      summary: 'Summary for arc 2',
      sourceSessionIds: ['s2'],
      campaignBible: {
        worldFacts: [],
        majorNpcs: [],
        factions: [],
        openThreads: [],
      },
      createdAt: '2026-03-01T00:00:00Z',
    });
    rollupArcSummary(db, {
      campaignId: 'c1',
      arcId: 'arc-1',
      summary: 'Summary for arc 1',
      sourceSessionIds: ['s1'],
      campaignBible: {
        worldFacts: [],
        majorNpcs: [],
        factions: [],
        openThreads: [],
      },
      createdAt: '2026-02-01T00:00:00Z',
    });

    const summaries = listClosedArcSummaries(db, { campaignId: 'c1' });
    expect(summaries).toHaveLength(2);
    expect(summaries[0]?.arcId).toBe('arc-1');
    expect(summaries[1]?.arcId).toBe('arc-2');
    db.close();
  });

  it('does not include open arcs', () => {
    const db = makeDb();
    openArcIfMissing(db, { campaignId: 'c1', now: '2026-01-01T00:00:00Z' });
    // arc-1 is open; no arc_summary row exists for it (open arcs never have summaries)
    const summaries = listClosedArcSummaries(db, { campaignId: 'c1' });
    expect(summaries).toEqual([]);
    db.close();
  });

  it('does not include open arc even with a hypothetical arc_summary row', () => {
    const db = makeDb();
    openArcIfMissing(db, { campaignId: 'c1', now: '2026-01-01T00:00:00Z' });
    // Manually insert an arc_summary for the open arc (defensive check)
    rollupArcSummary(db, {
      campaignId: 'c1',
      arcId: 'arc-1',
      summary: 'Premature summary',
      sourceSessionIds: [],
      campaignBible: {
        worldFacts: [],
        majorNpcs: [],
        factions: [],
        openThreads: [],
      },
      createdAt: '2026-01-15T00:00:00Z',
    });
    // The join filter on status='closed' should exclude it
    const summaries = listClosedArcSummaries(db, { campaignId: 'c1' });
    expect(summaries).toEqual([]);
    db.close();
  });
});
