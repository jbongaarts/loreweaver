import type {
  Encounter,
  Lore,
  Location,
  ModuleMeta,
  ModulePack,
  ModuleRulesRequirements,
  Npc,
  PackLicense,
  Trigger,
} from './types.js';

export class WorldModuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorldModuleError';
  }
}

type Obj = Record<string, unknown>;

function obj(value: unknown, path: string): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WorldModuleError(`${path} must be an object`);
  }
  return value as Obj;
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new WorldModuleError(`${path} must be a non-empty string`);
  }
  return value;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new WorldModuleError(`${path} must be a boolean`);
  }
  return value;
}

function int(value: unknown, path: string, min: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw new WorldModuleError(`${path} must be an integer >= ${min}`);
  }
  return value;
}

function arr(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new WorldModuleError(`${path} must be an array`);
  }
  return value;
}

function strArray(value: unknown, path: string): string[] {
  return arr(value, path).map((item, i) => str(item, `${path}[${i}]`));
}

function oneOf<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  const s = str(value, path);
  if (!(allowed as readonly string[]).includes(s)) {
    throw new WorldModuleError(`${path} must be one of: ${allowed.join(', ')}`);
  }
  return s as T;
}

function license(value: unknown): PackLicense {
  const o = obj(value, 'meta.license');
  return {
    licenseClass: oneOf(o.licenseClass, 'meta.license.licenseClass', [
      'open',
      'public-domain',
      'original',
      'publisher-licensed',
      'user-private',
    ]),
    licenseName: str(o.licenseName, 'meta.license.licenseName'),
    attributionText: str(o.attributionText, 'meta.license.attributionText'),
    requiresAttribution: bool(
      o.requiresAttribution,
      'meta.license.requiresAttribution',
    ),
    commercialUseAllowed: bool(
      o.commercialUseAllowed,
      'meta.license.commercialUseAllowed',
    ),
    hostedUseAllowed: bool(o.hostedUseAllowed, 'meta.license.hostedUseAllowed'),
    redistributionAllowed: bool(
      o.redistributionAllowed,
      'meta.license.redistributionAllowed',
    ),
    publicSharingAllowed: bool(
      o.publicSharingAllowed,
      'meta.license.publicSharingAllowed',
    ),
    derivativeAllowed: bool(
      o.derivativeAllowed,
      'meta.license.derivativeAllowed',
    ),
    containsUserSuppliedText: bool(
      o.containsUserSuppliedText,
      'meta.license.containsUserSuppliedText',
    ),
    containsTrademarkedSettingMaterial: bool(
      o.containsTrademarkedSettingMaterial,
      'meta.license.containsTrademarkedSettingMaterial',
    ),
    sourceMaterialDescription: str(
      o.sourceMaterialDescription,
      'meta.license.sourceMaterialDescription',
    ),
    provenancePolicy: str(o.provenancePolicy, 'meta.license.provenancePolicy'),
    outputRestrictions: str(
      o.outputRestrictions,
      'meta.license.outputRestrictions',
    ),
  };
}

function rulesRequirements(value: unknown): ModuleRulesRequirements {
  const o = obj(value, 'meta.rulesRequirements');
  const baseVersions =
    o.baseVersions === undefined
      ? undefined
      : strArray(o.baseVersions, 'meta.rulesRequirements.baseVersions');
  const requiredAddonPackIds =
    o.requiredAddonPackIds === undefined
      ? undefined
      : strArray(
          o.requiredAddonPackIds,
          'meta.rulesRequirements.requiredAddonPackIds',
        );
  const optionalAddonPackIds =
    o.optionalAddonPackIds === undefined
      ? undefined
      : strArray(
          o.optionalAddonPackIds,
          'meta.rulesRequirements.optionalAddonPackIds',
        );
  return {
    baseSystemId: str(o.baseSystemId, 'meta.rulesRequirements.baseSystemId'),
    ...(baseVersions === undefined ? {} : { baseVersions }),
    ...(requiredAddonPackIds === undefined ? {} : { requiredAddonPackIds }),
    ...(optionalAddonPackIds === undefined ? {} : { optionalAddonPackIds }),
  };
}

function meta(value: unknown): ModuleMeta {
  const o = obj(value, 'meta');
  if (o.rulesRequirements === undefined) {
    throw new WorldModuleError('meta.rulesRequirements is required');
  }
  return {
    packId: str(o.packId, 'meta.packId'),
    title: str(o.title, 'meta.title'),
    packType: oneOf(o.packType, 'meta.packType', [
      'adventure',
      'setting',
      'bestiary',
      'mixed',
    ]),
    description: str(o.description, 'meta.description'),
    startingLocationId: str(o.startingLocationId, 'meta.startingLocationId'),
    license: license(o.license),
    rulesRequirements: rulesRequirements(o.rulesRequirements),
  };
}

function location(value: unknown, i: number): Location {
  const o = obj(value, `locations[${i}]`);
  return {
    id: str(o.id, `locations[${i}].id`),
    name: str(o.name, `locations[${i}].name`),
    summary: str(o.summary, `locations[${i}].summary`),
    description: str(o.description, `locations[${i}].description`),
    exits: arr(o.exits, `locations[${i}].exits`).map((e, j) => {
      const eo = obj(e, `locations[${i}].exits[${j}]`);
      return {
        direction: str(eo.direction, `locations[${i}].exits[${j}].direction`),
        toLocationId: str(
          eo.toLocationId,
          `locations[${i}].exits[${j}].toLocationId`,
        ),
      };
    }),
    encounterIds: strArray(o.encounterIds, `locations[${i}].encounterIds`),
    npcIds: strArray(o.npcIds, `locations[${i}].npcIds`),
    tags: strArray(o.tags, `locations[${i}].tags`),
  };
}

function encounter(value: unknown, i: number): Encounter {
  const o = obj(value, `encounters[${i}]`);
  return {
    id: str(o.id, `encounters[${i}].id`),
    name: str(o.name, `encounters[${i}].name`),
    description: str(o.description, `encounters[${i}].description`),
    locationId: str(o.locationId, `encounters[${i}].locationId`),
    creatures: arr(o.creatures, `encounters[${i}].creatures`).map((c, j) => {
      const co = obj(c, `encounters[${i}].creatures[${j}]`);
      return {
        rulesRef: str(co.rulesRef, `encounters[${i}].creatures[${j}].rulesRef`),
        count: int(co.count, `encounters[${i}].creatures[${j}].count`, 1),
        role: str(co.role, `encounters[${i}].creatures[${j}].role`),
      };
    }),
    reward: str(o.reward, `encounters[${i}].reward`),
  };
}

function npc(value: unknown, i: number): Npc {
  const o = obj(value, `npcs[${i}]`);
  return {
    id: str(o.id, `npcs[${i}].id`),
    name: str(o.name, `npcs[${i}].name`),
    role: str(o.role, `npcs[${i}].role`),
    locationId: str(o.locationId, `npcs[${i}].locationId`),
    disposition: str(o.disposition, `npcs[${i}].disposition`),
    summary: str(o.summary, `npcs[${i}].summary`),
    secret: str(o.secret, `npcs[${i}].secret`),
  };
}

function trigger(value: unknown, i: number): Trigger {
  const o = obj(value, `triggers[${i}]`);
  return {
    id: str(o.id, `triggers[${i}].id`),
    when: str(o.when, `triggers[${i}].when`),
    effect: str(o.effect, `triggers[${i}].effect`),
    once: bool(o.once, `triggers[${i}].once`),
  };
}

function lore(value: unknown, i: number): Lore {
  const o = obj(value, `lore[${i}]`);
  return {
    id: str(o.id, `lore[${i}].id`),
    title: str(o.title, `lore[${i}].title`),
    text: str(o.text, `lore[${i}].text`),
    scope: oneOf(o.scope, `lore[${i}].scope`, ['public', 'dm']),
  };
}

function assertUniqueIds(items: readonly { id: string }[], path: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new WorldModuleError(`${path} has duplicate id: ${item.id}`);
    }
    seen.add(item.id);
  }
}

/**
 * `:` is the segment delimiter in a world overlay key
 * (`world:<type>:<id>:<field>`). An entity id containing `:` could let two
 * distinct ids/fields collapse onto one overlay key, so reject it here.
 */
function assertColonFreeIds(
  items: readonly { id: string }[],
  path: string,
): void {
  for (const item of items) {
    if (item.id.includes(':')) {
      throw new WorldModuleError(
        `${path} id must not contain ':': '${item.id}'`,
      );
    }
  }
}

/**
 * Structurally validate an untrusted value as a {@link ModulePack}. Throws
 * {@link WorldModuleError} on the first problem; on success returns a typed
 * pack. Also enforces referential integrity: ids are unique within a kind,
 * `startingLocationId` and exits resolve to real locations, encounter/NPC
 * `locationId`s resolve to locations, and a location's `encounterIds`/`npcIds`
 * resolve to real encounters/NPCs.
 */
export function validateModulePack(value: unknown): ModulePack {
  const o = obj(value, 'module');
  const pack: ModulePack = {
    meta: meta(o.meta),
    locations: arr(o.locations, 'locations').map(location),
    encounters: arr(o.encounters, 'encounters').map(encounter),
    npcs: arr(o.npcs, 'npcs').map(npc),
    triggers: arr(o.triggers, 'triggers').map(trigger),
    lore: arr(o.lore, 'lore').map(lore),
  };

  assertUniqueIds(pack.locations, 'locations');
  assertUniqueIds(pack.encounters, 'encounters');
  assertUniqueIds(pack.npcs, 'npcs');
  assertUniqueIds(pack.triggers, 'triggers');
  assertUniqueIds(pack.lore, 'lore');

  // World overlay targets (location/encounter/npc/lore) key their overlays by
  // id, so their ids must be colon-free.
  assertColonFreeIds(pack.locations, 'locations');
  assertColonFreeIds(pack.encounters, 'encounters');
  assertColonFreeIds(pack.npcs, 'npcs');
  assertColonFreeIds(pack.lore, 'lore');

  const locationIds = new Set(pack.locations.map((l) => l.id));
  const encounterIds = new Set(pack.encounters.map((e) => e.id));
  const npcIds = new Set(pack.npcs.map((n) => n.id));

  if (!locationIds.has(pack.meta.startingLocationId)) {
    throw new WorldModuleError(
      `meta.startingLocationId '${pack.meta.startingLocationId}' does not resolve to a location`,
    );
  }
  for (const l of pack.locations) {
    for (const exit of l.exits) {
      if (!locationIds.has(exit.toLocationId)) {
        throw new WorldModuleError(
          `locations[${l.id}] exit '${exit.direction}' points at unknown location '${exit.toLocationId}'`,
        );
      }
    }
    for (const encounterId of l.encounterIds) {
      if (!encounterIds.has(encounterId)) {
        throw new WorldModuleError(
          `locations[${l.id}] encounterIds references unknown encounter '${encounterId}'`,
        );
      }
    }
    for (const npcId of l.npcIds) {
      if (!npcIds.has(npcId)) {
        throw new WorldModuleError(
          `locations[${l.id}] npcIds references unknown npc '${npcId}'`,
        );
      }
    }
  }
  for (const e of pack.encounters) {
    if (!locationIds.has(e.locationId)) {
      throw new WorldModuleError(
        `encounters[${e.id}] locationId '${e.locationId}' does not resolve to a location`,
      );
    }
  }
  for (const n of pack.npcs) {
    if (!locationIds.has(n.locationId)) {
      throw new WorldModuleError(
        `npcs[${n.id}] locationId '${n.locationId}' does not resolve to a location`,
      );
    }
  }

  return pack;
}
