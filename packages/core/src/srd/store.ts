import { SRD_CATALOG, SRD_LICENSE } from './data.js';
import type {
  SrdCatalog,
  SrdKind,
  SrdLookupInput,
  SrdLookupResult,
  SrdRecord,
} from './types.js';

interface SrdKindIndex {
  readonly byRef: ReadonlyMap<string, SrdRecord>;
  readonly byName: ReadonlyMap<string, SrdRecord>;
}

type SrdIndex = Readonly<Record<SrdKind, SrdKindIndex>>;

const CATALOG_KEYS = {
  monster: 'monsters',
  spell: 'spells',
  class: 'classes',
} as const satisfies Readonly<Record<SrdKind, keyof SrdCatalog>>;

let defaultIndex: SrdIndex | undefined;

export function buildSrdIndex(catalog: SrdCatalog): SrdIndex {
  return {
    monster: buildKindIndex(catalog.monsters),
    spell: buildKindIndex(catalog.spells),
    class: buildKindIndex(catalog.classes),
  };
}

export function lookupSrdRecord(
  input: SrdLookupInput,
  catalog: SrdCatalog = SRD_CATALOG,
): SrdLookupResult {
  const index = catalog === SRD_CATALOG ? getDefaultIndex() : buildSrdIndex(catalog);
  const kindIndex = index[input.kind];
  const record =
    input.ref !== undefined
      ? kindIndex.byRef.get(input.ref)
      : kindIndex.byName.get(normalizeName(input.name));

  if (!record) {
    return {
      ok: false,
      code: 'not_found',
      message: `No SRD ${input.kind} found for ${describeLookupInput(input)}.`,
    };
  }

  return {
    ok: true,
    record,
    license: SRD_LICENSE,
  };
}

function getDefaultIndex(): SrdIndex {
  defaultIndex ??= buildSrdIndex(SRD_CATALOG);
  return defaultIndex;
}

function buildKindIndex(records: readonly SrdRecord[]): SrdKindIndex {
  return {
    byRef: new Map(records.map((record) => [record.ref, record])),
    byName: new Map(records.map((record) => [normalizeName(record.name), record])),
  };
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function describeLookupInput(input: SrdLookupInput): string {
  if (input.ref !== undefined) {
    return `ref ${input.ref}`;
  }

  return `name ${input.name}`;
}

export function catalogRecordsForKind(
  catalog: SrdCatalog,
  kind: SrdKind,
): readonly SrdRecord[] {
  return catalog[CATALOG_KEYS[kind]];
}
