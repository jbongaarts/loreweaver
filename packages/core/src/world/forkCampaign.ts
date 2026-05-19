import type { Db } from '../persistence/db.js';
import { withTransaction } from '../persistence/db.js';
import type { ModulePack } from './types.js';

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
    for (const table of [
      'module_meta',
      'module_location',
      'module_encounter',
      'module_npc',
      'module_trigger',
      'module_lore',
    ]) {
      txn.prepare(`DELETE FROM ${table}`).run();
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
        JSON.stringify(pack.meta.license),
        JSON.stringify(pack.meta),
      );

    const insLocation = txn.prepare(
      `INSERT INTO module_location(id, name, summary, data_json)
       VALUES (?, ?, ?, ?)`,
    );
    for (const l of pack.locations) {
      insLocation.run(l.id, l.name, l.summary, JSON.stringify(l));
    }

    const insEncounter = txn.prepare(
      `INSERT INTO module_encounter(id, name, location_id, data_json)
       VALUES (?, ?, ?, ?)`,
    );
    for (const e of pack.encounters) {
      insEncounter.run(e.id, e.name, e.locationId, JSON.stringify(e));
    }

    const insNpc = txn.prepare(
      `INSERT INTO module_npc(id, name, location_id, data_json)
       VALUES (?, ?, ?, ?)`,
    );
    for (const n of pack.npcs) {
      insNpc.run(n.id, n.name, n.locationId, JSON.stringify(n));
    }

    const insTrigger = txn.prepare(
      `INSERT INTO module_trigger(id, data_json) VALUES (?, ?)`,
    );
    for (const t of pack.triggers) {
      insTrigger.run(t.id, JSON.stringify(t));
    }

    const insLore = txn.prepare(
      `INSERT INTO module_lore(id, title, scope, data_json)
       VALUES (?, ?, ?, ?)`,
    );
    for (const lore of pack.lore) {
      insLore.run(lore.id, lore.title, lore.scope, JSON.stringify(lore));
    }
  });
}
