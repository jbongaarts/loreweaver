/**
 * Campaign create / select (E6).
 *
 * A campaign DB holds exactly one forked module template (`module_meta` has a
 * single-row check). This module gives the player-facing front-end a SQL-free
 * way to create a campaign from a module pack and to read its identity back —
 * the "create or select" decision a launcher makes before touching session
 * lifecycle. It holds no game-rule logic: creation just forks the template and
 * records the campaign id; selection is a read.
 */

import type { Db } from './persistence/db.js';
import { withTransaction } from './persistence/db.js';
import { forkModuleIntoCampaign } from './world/forkCampaign.js';
import type { ModulePack } from './world/types.js';

const CAMPAIGN_ID_META_KEY = 'campaign_id';

export class CampaignError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CampaignError';
  }
}

export interface CampaignInfo {
  campaignId: string;
  packId: string;
  title: string;
  startingLocationId: string;
}

export interface CreateCampaignInput {
  campaignId: string;
  pack: ModulePack;
}

/**
 * Create a campaign by forking a module template into the database and
 * recording the campaign id. Fails if a campaign already exists — a campaign
 * DB is single-campaign, so re-creating would clobber forked canon.
 */
export function createCampaign(
  db: Db,
  input: CreateCampaignInput,
): CampaignInfo {
  const campaignId = input.campaignId.trim();
  if (campaignId.length === 0) {
    throw new CampaignError('createCampaign campaignId is required');
  }
  if (getCampaign(db) !== undefined) {
    throw new CampaignError(
      'a campaign already exists in this database; create a new database ' +
        'for a new campaign',
    );
  }

  return withTransaction(db, (txnDb) => {
    forkModuleIntoCampaign(txnDb, input.pack);
    txnDb
      .prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)')
      .run(CAMPAIGN_ID_META_KEY, campaignId);
    return {
      campaignId,
      packId: input.pack.meta.packId,
      title: input.pack.meta.title,
      startingLocationId: input.pack.meta.startingLocationId,
    };
  });
}

/**
 * Read the campaign in this database, or `undefined` if none has been created.
 * A campaign exists once {@link createCampaign} has both forked a module and
 * recorded the campaign id.
 */
export function getCampaign(db: Db): CampaignInfo | undefined {
  const idRow = db
    .prepare('SELECT value FROM meta WHERE key = ?')
    .get(CAMPAIGN_ID_META_KEY) as { value: string } | undefined;
  if (idRow === undefined) {
    return undefined;
  }
  const moduleRow = db
    .prepare(
      'SELECT pack_id, title, starting_location_id FROM module_meta WHERE id = 1',
    )
    .get() as
    | { pack_id: string; title: string; starting_location_id: string }
    | undefined;
  if (moduleRow === undefined) {
    return undefined;
  }
  return {
    campaignId: idRow.value,
    packId: moduleRow.pack_id,
    title: moduleRow.title,
    startingLocationId: moduleRow.starting_location_id,
  };
}
