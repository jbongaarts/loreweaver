import type { Db } from '../persistence/db.js';
import { jsonColumn } from '../persistence/jsonColumn.js';
import type {
  WorldOverlay,
  WorldQueryResult,
  WorldQueryTarget,
  WorldTargetType,
} from './types.js';
import { WorldModuleError } from './validate.js';
import { classifyVisibility } from './worldVisibility.js';

/** JSON codecs for the JSON-backed columns worldQuery reads. */
const templateDataColumn =
  jsonColumn<Record<string, unknown>>('module_*.data_json');
const overlayValueColumn = jsonColumn<unknown>('overlay_facts.value_json');

/**
 * Build the `overlay_facts` key that records a live divergence of a module
 * template field. Live writes go through `mutateState` with
 * `target: 'overlay_facts'` and `field` set to this key; `worldQuery` folds
 * matching overlay facts back over the template at read time.
 *
 * `meta` has no id; pass `''`. Rejects `:` in `id` or `field`: it is the key
 * segment delimiter, so allowing it would let two distinct `(id, field)` pairs
 * collapse onto one overlay key and silently overwrite each other.
 */
export function worldOverlayKey(
  type: WorldTargetType,
  id: string,
  field: string,
): string {
  if (id.includes(':')) {
    throw new WorldModuleError(
      `world overlay id must not contain ':' (got '${id}')`,
    );
  }
  if (field.includes(':')) {
    throw new WorldModuleError(
      `world overlay field must not contain ':' (got '${field}')`,
    );
  }
  return `world:${type}:${id}:${field}`;
}

/**
 * Escape SQL LIKE wildcards so an overlay-key prefix matches literally. Without
 * this, an overlay key for an id containing `_` (single-char wildcard) or `%`
 * (any-string wildcard) would fold over the wrong template record. Pairs with
 * `ESCAPE '\'` on the query. The backslash itself is escaped first.
 */
function escapeLikePrefix(prefix: string): string {
  return prefix.replace(/[\\%_]/g, (char) => `\\${char}`);
}

const TABLE_BY_TYPE: Record<WorldTargetType, string> = {
  location: 'module_location',
  encounter: 'module_encounter',
  npc: 'module_npc',
  lore: 'module_lore',
  meta: 'module_meta',
};

interface OverlayRow {
  key: string;
  value_json: string;
  provenance: string;
  session_id: string;
  updated_at: string;
}

/**
 * Resolve a world target to template-plus-overlay truth so the model never
 * narrates a stale template. Reads the immutable forked template, then applies
 * the unique overlay fact stored for each diverged field. Returns the resolved
 * view, the raw template, and the overlay fields that diverged it.
 */
export function worldQuery(db: Db, target: WorldQueryTarget): WorldQueryResult {
  const table = TABLE_BY_TYPE[target.type];
  const id = target.type === 'meta' ? '' : target.id;

  if (target.type !== 'meta' && (id === undefined || id.length === 0)) {
    return {
      ok: false,
      code: 'not_found',
      message: `world target ${target.type} requires an id`,
    };
  }

  const templateRow = (
    target.type === 'meta'
      ? db.prepare(`SELECT data_json FROM ${table} WHERE id = 1`).get()
      : db.prepare(`SELECT data_json FROM ${table} WHERE id = ?`).get(id)
  ) as { data_json: string } | undefined;

  if (templateRow === undefined) {
    return {
      ok: false,
      code: 'not_found',
      message: `no ${target.type} '${id ?? ''}' in the campaign template`,
    };
  }

  const template = templateDataColumn.decode(templateRow.data_json);

  const prefix = worldOverlayKey(target.type, id ?? '', '');
  const overlayRows = db
    .prepare(
      `SELECT key, value_json, provenance, session_id, updated_at
       FROM overlay_facts
       WHERE key LIKE ? ESCAPE '\\'`,
    )
    .all(`${escapeLikePrefix(prefix)}%`) as OverlayRow[];

  const overlays: WorldOverlay[] = [];
  const resolved: Record<string, unknown> = { ...template };
  for (const row of overlayRows) {
    const field = row.key.slice(prefix.length);
    if (field.length === 0) {
      continue;
    }
    const value = overlayValueColumn.decode(row.value_json);
    resolved[field] = value;
    overlays.push({
      field,
      value,
      provenance: row.provenance,
      sessionId: row.session_id,
      updatedAt: row.updated_at,
    });
  }

  const { visibility, dmOnlyFields } = classifyVisibility(
    target.type,
    resolved,
  );

  return {
    ok: true,
    type: target.type,
    id: target.type === 'meta' ? undefined : id,
    resolved,
    template,
    overlays,
    visibility,
    dmOnlyFields,
  };
}
