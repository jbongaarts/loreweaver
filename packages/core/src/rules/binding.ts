import type { Db } from '../persistence/db.js';
import { jsonColumn } from '../persistence/jsonColumn.js';
import { DND5E_SRD_RULES_PACK } from './dnd5eSrd.js';

export interface CampaignRulesBindingPackRef {
  readonly systemId: string;
  readonly packId: string;
  readonly version: string;
}

export interface CampaignRulesBinding {
  readonly base: CampaignRulesBindingPackRef;
  readonly addons: readonly CampaignRulesBindingPackRef[];
  readonly resolvedAt: string;
}

const DEFAULT_RESOLVED_AT = '1970-01-01T00:00:00.000Z';

export const DEFAULT_DND5E_SRD_BINDING: CampaignRulesBinding = {
  base: {
    systemId: DND5E_SRD_RULES_PACK.meta.systemId,
    packId: DND5E_SRD_RULES_PACK.meta.packId,
    version: DND5E_SRD_RULES_PACK.meta.version,
  },
  addons: [],
  resolvedAt: DEFAULT_RESOLVED_AT,
};

const addonsColumn = jsonColumn<CampaignRulesBindingPackRef[]>(
  'campaign_rules_binding.addons_json',
);

interface CampaignRulesBindingRow {
  readonly base_system_id: string;
  readonly base_pack_id: string;
  readonly base_version: string;
  readonly addons_json: string;
  readonly resolved_at: string;
}

export function writeCampaignRulesBinding(
  db: Db,
  binding: CampaignRulesBinding,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO campaign_rules_binding(
       id, base_system_id, base_pack_id, base_version, addons_json, resolved_at
     ) VALUES (1, ?, ?, ?, ?, ?)`,
  ).run(
    binding.base.systemId,
    binding.base.packId,
    binding.base.version,
    addonsColumn.encode([...binding.addons]),
    binding.resolvedAt,
  );
}

export function readCampaignRulesBinding(
  db: Db,
): CampaignRulesBinding | undefined {
  const row = db
    .prepare(
      `SELECT base_system_id, base_pack_id, base_version, addons_json, resolved_at
       FROM campaign_rules_binding WHERE id = 1`,
    )
    .get() as CampaignRulesBindingRow | undefined;
  if (row === undefined) {
    return undefined;
  }
  return {
    base: {
      systemId: row.base_system_id,
      packId: row.base_pack_id,
      version: row.base_version,
    },
    addons: addonsColumn.decode(row.addons_json),
    resolvedAt: row.resolved_at,
  };
}
