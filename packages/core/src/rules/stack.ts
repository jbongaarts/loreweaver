import { RulesPackError } from './types.js';
import type {
  CompatibleBaseSystem,
  RulesPack,
  RulesPackMeta,
  RulesRecord,
  RulesRecordKind,
} from './types.js';

interface OrderedAddonMeta extends RulesPackMeta {
  readonly order?: number;
  readonly dependsOn?: readonly string[];
}

interface OrderedRulesPack extends RulesPack {
  readonly meta: OrderedAddonMeta;
}

export interface ResolveRulesStackInput {
  readonly base: RulesPack;
  readonly addons?: readonly RulesPack[];
}

export interface RulesStackRecordSource {
  readonly record: RulesRecord;
  readonly pack: RulesPack;
  readonly license: RulesRecord['license'];
}

export interface RulesStackRecordEntry extends RulesStackRecordSource {
  readonly overrideChain: readonly RulesStackRecordSource[];
}

export interface RulesStackKindIndex {
  readonly byKey: ReadonlyMap<string, RulesStackRecordEntry>;
  readonly byName: ReadonlyMap<string, RulesStackRecordEntry>;
}

export interface ResolvedRulesStack {
  readonly base: RulesPack;
  readonly addons: readonly RulesPack[];
  readonly packs: readonly RulesPack[];
  readonly recordsByKey: ReadonlyMap<string, RulesStackRecordEntry>;
  readonly recordsByKind: ReadonlyMap<RulesRecordKind, RulesStackKindIndex>;
}

export function resolveRulesStack(
  input: ResolveRulesStackInput,
): ResolvedRulesStack {
  assertBasePack(input.base);

  const addons = orderAddons(input.addons ?? []);
  for (const addon of addons) {
    assertAddonPack(addon);
    assertCompatibleWithBase(addon, input.base.meta);
  }
  assertDependencies(addons);

  const packs = [input.base, ...addons];
  const recordsByKey = new Map<string, RulesStackRecordEntry>();
  const recordsByKind = new Map<RulesRecordKind, RulesStackKindIndexBuilder>();

  for (const pack of packs) {
    for (const record of pack.records) {
      const existing = recordsByKey.get(record.key);
      const entry = mergeRecord(pack, record, existing);
      if (existing !== undefined) {
        removeFromKindIndex(recordsByKind, existing);
      }
      recordsByKey.set(record.key, entry);
      addToKindIndex(kindIndexFor(recordsByKind, record.kind), record, entry);
    }
  }

  return {
    base: input.base,
    addons,
    packs,
    recordsByKey,
    recordsByKind: freezeKindIndexes(recordsByKind),
  };
}

function assertBasePack(pack: RulesPack): void {
  if (pack.meta.role !== 'base') {
    throw new RulesPackError(
      `rules stack base pack must have role base: ${pack.meta.packId}`,
    );
  }
}

function assertAddonPack(pack: RulesPack): asserts pack is OrderedRulesPack {
  if (pack.meta.role !== 'addon') {
    throw new RulesPackError(
      `rules stack add-on pack must have role addon: ${pack.meta.packId}`,
    );
  }
}

function orderAddons(addons: readonly RulesPack[]): readonly OrderedRulesPack[] {
  return addons
    .map((pack, index) => ({ pack: pack as OrderedRulesPack, index }))
    .sort((a, b) => {
      const orderDelta = addonOrder(a.pack) - addonOrder(b.pack);
      return orderDelta === 0 ? a.index - b.index : orderDelta;
    })
    .map((item) => item.pack);
}

function addonOrder(pack: OrderedRulesPack): number {
  return pack.meta.order ?? Number.MAX_SAFE_INTEGER;
}

function assertCompatibleWithBase(
  addon: OrderedRulesPack,
  base: RulesPackMeta,
): void {
  const compatible = addon.meta.compatibleBaseSystems?.some((candidate) =>
    matchesBase(candidate, base),
  );
  if (!compatible) {
    throw new RulesPackError(
      `add-on ${addon.meta.packId} does not declare a compatible base for ${base.systemId} ${base.version}`,
    );
  }
}

function matchesBase(
  compatibleBase: CompatibleBaseSystem,
  base: RulesPackMeta,
): boolean {
  return (
    compatibleBase.systemId === base.systemId &&
    compatibleBase.versions.includes(base.version)
  );
}

function assertDependencies(addons: readonly OrderedRulesPack[]): void {
  const addonIds = new Set(addons.map((addon) => addon.meta.packId));
  const resolved = new Set<string>();

  for (const addon of addons) {
    for (const dependency of addon.meta.dependsOn ?? []) {
      if (!addonIds.has(dependency)) {
        throw new RulesPackError(
          `add-on ${addon.meta.packId} has missing dependency: ${dependency}`,
        );
      }
      if (!resolved.has(dependency)) {
        throw new RulesPackError(
          `add-on ${addon.meta.packId} depends on ${dependency}, which must resolve earlier in the stack`,
        );
      }
    }
    resolved.add(addon.meta.packId);
  }
}

function mergeRecord(
  pack: RulesPack,
  record: RulesRecord,
  existing: RulesStackRecordEntry | undefined,
): RulesStackRecordEntry {
  if (existing === undefined) {
    return {
      record,
      pack,
      license: record.license,
      overrideChain: [],
    };
  }

  if (!namesOverride(record, existing)) {
    throw new RulesPackError(
      `duplicate record key ${record.key} from ${pack.meta.packId} must explicitly override ${existing.pack.meta.packId}`,
    );
  }

  return {
    record,
    pack,
    license: record.license,
    overrideChain: [
      ...existing.overrideChain,
      {
        record: existing.record,
        pack: existing.pack,
        license: existing.license,
      },
    ],
  };
}

function namesOverride(
  record: RulesRecord,
  existing: RulesStackRecordEntry,
): boolean {
  return (record.overrides ?? []).some((ref) =>
    overrideRefMatches(ref, existing.pack.meta.packId, existing.record.key),
  );
}

function overrideRefMatches(ref: string, packId: string, key: string): boolean {
  return (
    ref === `${packId}/${key}` ||
    ref === `${packId}#${key}` ||
    ref === `${packId}:${key}`
  );
}

interface RulesStackKindIndexBuilder {
  readonly byKey: Map<string, RulesStackRecordEntry>;
  readonly byName: Map<string, RulesStackRecordEntry>;
}

function kindIndexFor(
  indexes: Map<RulesRecordKind, RulesStackKindIndexBuilder>,
  kind: RulesRecordKind,
): RulesStackKindIndexBuilder {
  const existing = indexes.get(kind);
  if (existing !== undefined) {
    return existing;
  }

  const created = { byKey: new Map(), byName: new Map() };
  indexes.set(kind, created);
  return created;
}

function addToKindIndex(
  index: RulesStackKindIndexBuilder,
  record: RulesRecord,
  entry: RulesStackRecordEntry,
): void {
  index.byKey.set(record.key, entry);
  index.byName.set(normalizeName(record.name), entry);
}

function removeFromKindIndex(
  indexes: ReadonlyMap<RulesRecordKind, RulesStackKindIndexBuilder>,
  entry: RulesStackRecordEntry,
): void {
  const index = indexes.get(entry.record.kind);
  if (index === undefined) {
    return;
  }

  if (index.byKey.get(entry.record.key) === entry) {
    index.byKey.delete(entry.record.key);
  }
  const name = normalizeName(entry.record.name);
  if (index.byName.get(name) === entry) {
    index.byName.delete(name);
  }
}

function freezeKindIndexes(
  indexes: ReadonlyMap<RulesRecordKind, RulesStackKindIndexBuilder>,
): ReadonlyMap<RulesRecordKind, RulesStackKindIndex> {
  return new Map(
    [...indexes.entries()].map(([kind, index]) => [
      kind,
      { byKey: index.byKey, byName: index.byName },
    ]),
  );
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

declare module './types.js' {
  interface RulesPackMeta {
    readonly order?: number;
    readonly dependsOn?: readonly string[];
  }
}

export { normalizeName as normalizeRulesRecordName };
