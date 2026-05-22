import { describe, expect, it } from 'vitest';
import {
  CampaignError,
  EMBERFALL_HOLLOW,
  createCampaign,
  getCampaign,
} from '../src/index.js';
import { bareDb } from './support/db.js';

describe('campaign create / select', () => {
  it('reports no campaign on a freshly initialized database', () => {
    const db = bareDb();
    expect(getCampaign(db)).toBeUndefined();
    db.close();
  });

  it('creates a campaign from a module template and reads it back', () => {
    const db = bareDb();

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
    const db = bareDb();
    createCampaign(db, { campaignId: 'campaign-1', pack: EMBERFALL_HOLLOW });

    expect(() =>
      createCampaign(db, { campaignId: 'campaign-2', pack: EMBERFALL_HOLLOW }),
    ).toThrow(CampaignError);
    db.close();
  });

  it('rejects a blank campaign id', () => {
    const db = bareDb();
    expect(() =>
      createCampaign(db, { campaignId: '   ', pack: EMBERFALL_HOLLOW }),
    ).toThrow(CampaignError);
    db.close();
  });
});
