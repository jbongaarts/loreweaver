import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import { jsonColumn } from '../persistence/jsonColumn.js';
import { quoteIdent } from '../persistence/sql.js';
import type { ModulePack, PackLicense } from './types.js';

/** JSON codecs for the module_* tables' JSON-backed columns. */
const moduleLicenseColumn = jsonColumn<PackLicense>('module_meta.license_json');
const moduleDataColumn = jsonColumn<unknown>('module_*.data_json');

/**
 * Fork an authored module pack into a campaign DB as the immutable template.
 *
 * The pack object is only read, never written back, so the authored files
 * stay pristine and a campaign can be re-forked. The operation is idempotent:
 * an existing template is fully replaced, so re-forking the same pack yields
 * the same rows. Live divergence is never written here — it goes to
 * `overlay_facts` (E3) and is resolved by {@link worldQuery}.
 *
 * Licensing is recorded into `module_meta` so share/host boundaries can
 * enforce policy; local forking itself is not license-gated.
 */
export function forkModuleIntoCampaign(db: Db, pack: ModulePack): void {
  withTransaction(db, (txn) => {
    // Trusted internal schema table names; quote through one helper so all
    // dynamic identifier SQL uses the same escaping behavior.
    for (const table of [
      'module_meta',
      'module_location',
      'module_encounter',
      'module_npc',
      'module_trigger',
      'module_lore',
    ]) {
      txn.prepare(`DELETE FROM ${quoteIdent(table)}`).run();
    }

    txn
      .prepare(
        `INSERT INTO module_meta(
           id, pack_id, title, pack_type, description,
           starting_location_id, license_json, data_json
         ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        pack.meta.packId,
        pack.meta.title,
        pack.meta.packType,
        pack.meta.description,
        pack.meta.startingLocationId,
        moduleLicenseColumn.encode(pack.meta.license),
        moduleDataColumn.encode(pack.meta),
      );

    const insLocation = txn.prepare(
      `INSERT INTO module_location(id, name, summary, data_json)
       VALUES (?, ?, ?, ?)`,
    );
    for (const l of pack.locations) {
      insLocation.run(l.id, l.name, l.summary, moduleDataColumn.encode(l));
    }

    const insEncounter = txn.prepare(
      `INSERT INTO module_encounter(id, name, location_id, data_json)
       VALUES (?, ?, ?, ?)`,
    );
    for (const e of pack.encounters) {
      insEncounter.run(e.id, e.name, e.locationId, moduleDataColumn.encode(e));
    }

    const insNpc = txn.prepare(
      `INSERT INTO module_npc(id, name, location_id, data_json)
       VALUES (?, ?, ?, ?)`,
    );
    for (const n of pack.npcs) {
      insNpc.run(n.id, n.name, n.locationId, moduleDataColumn.encode(n));
    }

    const insTrigger = txn.prepare(
      `INSERT INTO module_trigger(id, data_json) VALUES (?, ?)`,
    );
    for (const t of pack.triggers) {
      insTrigger.run(t.id, moduleDataColumn.encode(t));
    }

    const insLore = txn.prepare(
      `INSERT INTO module_lore(id, title, scope, data_json)
       VALUES (?, ?, ?, ?)`,
    );
    for (const lore of pack.lore) {
      insLore.run(lore.id, lore.title, lore.scope, moduleDataColumn.encode(lore));
    }
  });
}
