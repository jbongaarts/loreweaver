import { describe, expect, it } from 'vitest';
import {
  CampaignError,
  EMBERFALL_HOLLOW,
  createCampaign,
  getCampaign,
  initSchema,
  openDatabase,
} from '../src/index.js';

function freshDb() {
  const db = openDatabase(':memory:');
  initSchema(db);
  return db;
}

describe('campaign create / select', () => {
  it('reports no campaign on a freshly initialized database', () => {
    const db = freshDb();
    expect(getCampaign(db)).toBeUndefined();
    db.close();
  });

  it('creates a campaign from a module template and reads it back', () => {
    const db = freshDb();

    const created = createCampaign(db, {
      campaignId: 'campaign-1',
      pack: EMBERFALL_HOLLOW,
    });

    expect(created).toEqual({
      campaignId: 'campaign-1',
      packId: EMBERFALL_HOLLOW.meta.packId,
      title: EMBERFALL_HOLLOW.meta.title,
      startingLocationId: EMBERFALL_HOLLOW.meta.startingLocationId,
    });
    // The module template was forked in: select reads the same identity back.
    expect(getCampaign(db)).toEqual(created);
    db.close();
  });

  it('refuses to create a second campaign in the same database', () => {
    const db = freshDb();
    createCampaign(db, { campaignId: 'campaign-1', pack: EMBERFALL_HOLLOW });

    expect(() =>
      createCampaign(db, { campaignId: 'campaign-2', pack: EMBERFALL_HOLLOW }),
    ).toThrow(CampaignError);
    db.close();
  });

  it('rejects a blank campaign id', () => {
    const db = freshDb();
    expect(() =>
      createCampaign(db, { campaignId: '   ', pack: EMBERFALL_HOLLOW }),
    ).toThrow(CampaignError);
    db.close();
  });
});
