import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  CheckpointStore,
  DoltRepo,
  EMBERFALL_HOLLOW,
  createCampaign,
  getCampaign,
  initSchema,
  openDatabase,
} from '@loreweaver/core';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveCampaignDbPath } from '../src/campaigns.js';
import {
  type CheckpointDeps,
  runCheckpointCommand,
} from '../src/checkpoints.js';
import {
  addCampaign,
  emptyRegistry,
  saveRegistry,
  type CampaignRegistryEntry,
} from '../src/registry.js';

const HAS_DOLT = DoltRepo.available();

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Dolt checkpoint files can briefly EPERM on Windows; temp cleanup covers it */
    }
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

interface Harness {
  deps: CheckpointDeps;
  logs: string[];
}

/** A checkpoint-command harness with a fresh data root and a chosen env. */
function harness(env: Record<string, string | undefined> = {}): Harness {
  const logs: string[] = [];
  return {
    logs,
    deps: {
      root: join(tempDir('lw-ckpt-root-'), 'data'),
      env,
      log: (message) => logs.push(message),
    },
  };
}

/** Create a campaign database with one checkpoint; return both ids. */
function campaignWithCheckpoint(): { dbPath: string; checkpointId: string } {
  const dir = tempDir('lw-ckpt-');
  const dbPath = join(dir, 'campaign.db');
  const db = openDatabase(dbPath);
  try {
    initSchema(db);
    createCampaign(db, { campaignId: 'c1', pack: EMBERFALL_HOLLOW });
  } finally {
    db.close();
  }
  const store = new CheckpointStore(
    `${dbPath}.checkpoints`,
    join(dir, '.beads'),
  );
  const checkpointId = store.checkpoint(dbPath, 'first checkpoint');
  return { dbPath, checkpointId };
}

describe('runCheckpointCommand argument handling', () => {
  it('rejects an unknown subcommand', () => {
    const h = harness();
    expect(runCheckpointCommand(['bogus'], h.deps)).toBe(1);
    expect(h.logs.join('\n')).toContain('usage');
  });

  it('reports usage when restore is missing a destination', () => {
    const h = harness();
    expect(runCheckpointCommand(['restore', 'abc123'], h.deps)).toBe(1);
    expect(h.logs.join('\n')).toContain('usage');
  });

  it('reports usage when fork is missing a destination', () => {
    const h = harness();
    expect(runCheckpointCommand(['fork', 'abc123', 'branch'], h.deps)).toBe(1);
    expect(h.logs.join('\n')).toContain('usage');
  });

  it('fails when no campaign can be resolved', () => {
    const h = harness();
    expect(runCheckpointCommand(['list'], h.deps)).toBe(1);
    expect(h.logs.join('\n')).toContain('no campaigns');
  });
});

describe('resolveCampaignDbPath', () => {
  function entry(
    over: Partial<CampaignRegistryEntry> = {},
  ): CampaignRegistryEntry {
    return {
      id: 'quest',
      name: 'Quest',
      dbPath: '/data/campaigns/quest.db',
      createdAt: '2026-05-22T00:00:00.000Z',
      ...over,
    };
  }

  it('prefers an explicit database path', () => {
    const result = resolveCampaignDbPath('/unused/root', {
      explicitDbPath: '/explicit/x.db',
      campaignId: 'quest',
    });
    expect(result).toEqual({ ok: true, dbPath: '/explicit/x.db' });
  });

  it('resolves a named registry campaign', () => {
    const root = tempDir('lw-reg-');
    saveRegistry(root, addCampaign(emptyRegistry(), entry()));
    expect(resolveCampaignDbPath(root, { campaignId: 'quest' })).toEqual({
      ok: true,
      dbPath: '/data/campaigns/quest.db',
    });
  });

  it('fails for an unknown campaign id', () => {
    const root = tempDir('lw-reg-');
    saveRegistry(root, addCampaign(emptyRegistry(), entry()));
    expect(resolveCampaignDbPath(root, { campaignId: 'nope' }).ok).toBe(false);
  });

  it('uses the sole registered campaign when none is named', () => {
    const root = tempDir('lw-reg-');
    saveRegistry(root, addCampaign(emptyRegistry(), entry()));
    expect(resolveCampaignDbPath(root, {})).toEqual({
      ok: true,
      dbPath: '/data/campaigns/quest.db',
    });
  });

  it('fails on an empty registry with no campaign named', () => {
    expect(resolveCampaignDbPath(tempDir('lw-reg-'), {}).ok).toBe(false);
  });

  it('requires a campaign id when several are registered', () => {
    const root = tempDir('lw-reg-');
    let registry = addCampaign(emptyRegistry(), entry({ id: 'a' }));
    registry = addCampaign(registry, entry({ id: 'b' }));
    saveRegistry(root, registry);
    const result = resolveCampaignDbPath(root, {});
    expect(result.ok).toBe(false);
  });
});

describe.skipIf(!HAS_DOLT)('runCheckpointCommand with Dolt', () => {
  it('lists a campaign checkpoint', () => {
    const { dbPath, checkpointId } = campaignWithCheckpoint();
    const h = harness({ LOREWEAVER_DB_PATH: dbPath });
    expect(runCheckpointCommand(['list'], h.deps)).toBe(0);
    expect(h.logs.join('\n')).toContain(checkpointId);
    expect(h.logs.join('\n')).toContain('first checkpoint');
  });

  it('reports no checkpoints for a campaign that has none', () => {
    const dbPath = join(tempDir('lw-ckpt-'), 'fresh.db');
    openDatabase(dbPath).close();
    const h = harness({ LOREWEAVER_DB_PATH: dbPath });
    expect(runCheckpointCommand(['list'], h.deps)).toBe(0);
    expect(h.logs.join('\n')).toContain('No checkpoints');
  });

  it('restores a checkpoint to a new database without touching the campaign', () => {
    const { dbPath, checkpointId } = campaignWithCheckpoint();
    const h = harness({ LOREWEAVER_DB_PATH: dbPath });
    const dest = join(dirname(dbPath), 'restored.db');
    expect(runCheckpointCommand(['restore', checkpointId, dest], h.deps)).toBe(
      0,
    );
    expect(existsSync(dest)).toBe(true);
    // the active campaign database is untouched and still openable
    const db = openDatabase(dbPath);
    try {
      expect(getCampaign(db)).toBeDefined();
    } finally {
      db.close();
    }
  });

  it('refuses to restore onto an existing destination', () => {
    const { dbPath, checkpointId } = campaignWithCheckpoint();
    const h = harness({ LOREWEAVER_DB_PATH: dbPath });
    const dest = join(dirname(dbPath), 'occupied.db');
    openDatabase(dest).close();
    expect(runCheckpointCommand(['restore', checkpointId, dest], h.deps)).toBe(
      1,
    );
    expect(h.logs.join('\n')).toContain('restore failed');
  });

  it('forks a checkpoint onto a new branch and database', () => {
    const { dbPath, checkpointId } = campaignWithCheckpoint();
    const h = harness({ LOREWEAVER_DB_PATH: dbPath });
    const dest = join(dirname(dbPath), 'forked.db');
    expect(
      runCheckpointCommand(['fork', checkpointId, 'altline', dest], h.deps),
    ).toBe(0);
    expect(existsSync(dest)).toBe(true);
  });

  it('refuses to fork onto an existing destination', () => {
    const { dbPath, checkpointId } = campaignWithCheckpoint();
    const h = harness({ LOREWEAVER_DB_PATH: dbPath });
    const dest = join(dirname(dbPath), 'occupied.db');
    openDatabase(dest).close();
    expect(
      runCheckpointCommand(['fork', checkpointId, 'altline', dest], h.deps),
    ).toBe(1);
    expect(h.logs.join('\n')).toContain('fork failed');
  });
});
