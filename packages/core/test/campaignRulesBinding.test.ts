import { describe, expect, it } from 'vitest';
import {
  CampaignError,
  DEFAULT_DND5E_SRD_BINDING,
  DND5E_SRD_RULES_PACK,
  EMBERFALL_HOLLOW,
  PATHFINDER2E_REMASTER_RULES_PACK,
  createCampaign,
  getCampaign,
  readCampaignRulesBinding,
  writeCampaignRulesBinding,
} from '../src/index.js';
import type { CampaignRulesBinding } from '../src/index.js';
import { bareDb } from './support/db.js';

describe('campaign rules binding', () => {
  it('persists a default D&D SRD binding when none is supplied', () => {
    const db = bareDb();

    const info = createCampaign(db, {
      campaignId: 'campaign-1',
      pack: EMBERFALL_HOLLOW,
    });

    expect(info.rulesBinding.base.systemId).toBe(
      DND5E_SRD_RULES_PACK.meta.systemId,
    );
    expect(info.rulesBinding.base.packId).toBe(
      DND5E_SRD_RULES_PACK.meta.packId,
    );
    expect(info.rulesBinding.base.version).toBe(
      DND5E_SRD_RULES_PACK.meta.version,
    );
    expect(info.rulesBinding.addons).toEqual([]);

    const stored = readCampaignRulesBinding(db);
    expect(stored).toBeDefined();
    expect(stored?.base.systemId).toBe(DND5E_SRD_RULES_PACK.meta.systemId);
    expect(stored?.base.packId).toBe(DND5E_SRD_RULES_PACK.meta.packId);
    expect(stored?.resolvedAt.length).toBeGreaterThan(0);

    db.close();
  });

  it('persists a caller-supplied binding with ordered add-ons', () => {
    const db = bareDb();
    const binding: CampaignRulesBinding = {
      base: {
        systemId: PATHFINDER2E_REMASTER_RULES_PACK.meta.systemId,
        packId: PATHFINDER2E_REMASTER_RULES_PACK.meta.packId,
        version: PATHFINDER2E_REMASTER_RULES_PACK.meta.version,
      },
      addons: [
        {
          systemId: PATHFINDER2E_REMASTER_RULES_PACK.meta.systemId,
          packId: 'rules:pathfinder2e-monsters',
          version: '1.0',
        },
        {
          systemId: PATHFINDER2E_REMASTER_RULES_PACK.meta.systemId,
          packId: 'rules:pathfinder2e-house-rules',
          version: '0.1',
        },
      ],
      resolvedAt: '2026-05-23T11:30:00.000Z',
    };

    const info = createCampaign(db, {
      campaignId: 'pf2e-campaign',
      pack: EMBERFALL_HOLLOW,
      rulesBinding: binding,
    });

    expect(info.rulesBinding).toEqual(binding);

    const stored = readCampaignRulesBinding(db);
    expect(stored).toEqual(binding);
    expect(stored?.addons.map((addon) => addon.packId)).toEqual([
      'rules:pathfinder2e-monsters',
      'rules:pathfinder2e-house-rules',
    ]);

    db.close();
  });

  it('reads same-version campaigns without a binding row as default D&D SRD', () => {
    const db = bareDb();
    createCampaign(db, { campaignId: 'campaign-1', pack: EMBERFALL_HOLLOW });

    db.prepare('DELETE FROM campaign_rules_binding').run();
    expect(readCampaignRulesBinding(db)).toBeUndefined();

    const info = getCampaign(db);
    expect(info?.rulesBinding).toEqual(DEFAULT_DND5E_SRD_BINDING);

    db.close();
  });

  it('round-trips through writeCampaignRulesBinding without createCampaign', () => {
    const db = bareDb();
    const binding: CampaignRulesBinding = {
      base: {
        systemId: 'dnd5e-srd',
        packId: 'rules:dnd5e-srd',
        version: '5.1',
      },
      addons: [],
      resolvedAt: '2026-05-23T00:00:00.000Z',
    };

    writeCampaignRulesBinding(db, binding);
    expect(readCampaignRulesBinding(db)).toEqual(binding);

    db.close();
  });

  it('still rejects empty campaign ids even when a binding is provided', () => {
    const db = bareDb();
    expect(() =>
      createCampaign(db, {
        campaignId: '   ',
        pack: EMBERFALL_HOLLOW,
        rulesBinding: DEFAULT_DND5E_SRD_BINDING,
      }),
    ).toThrow(CampaignError);
    db.close();
  });

  it('exposes DEFAULT_DND5E_SRD_BINDING with the D&D SRD pack identity', () => {
    expect(DEFAULT_DND5E_SRD_BINDING.base.systemId).toBe(
      DND5E_SRD_RULES_PACK.meta.systemId,
    );
    expect(DEFAULT_DND5E_SRD_BINDING.base.packId).toBe(
      DND5E_SRD_RULES_PACK.meta.packId,
    );
    expect(DEFAULT_DND5E_SRD_BINDING.base.version).toBe(
      DND5E_SRD_RULES_PACK.meta.version,
    );
    expect(DEFAULT_DND5E_SRD_BINDING.addons).toEqual([]);
  });
});
