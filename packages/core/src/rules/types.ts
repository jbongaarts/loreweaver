import type { PackLicense, PackLicenseClass } from '../world/types.js';

export type RulesPackRole = 'base' | 'addon';

export type RulesRecordKind =
  | 'ability'
  | 'action'
  | 'ancestry'
  | 'background'
  | 'class'
  | 'condition'
  | 'creature'
  | 'equipment'
  | 'feat'
  // `feature` is class/subclass-granted (Action Surge, Rage, ...), distinct
  // from the player-selected `feat`. See ADR 0009.
  | 'feature'
  | 'hazard'
  | 'rule'
  | 'spell'
  // `subclass` (Champion, Life domain, School of Evocation, ...) is its own
  // addressable kind; it links to its parent base `class` via
  // `data.parentClass`. See ADR 0009.
  | 'subclass'
  | 'table';

export type RulesPackLicense = PackLicense;
export type RulesPackLicenseClass = PackLicenseClass;

export interface CompatibleBaseSystem {
  readonly systemId: string;
  readonly versions: readonly string[];
}

/**
 * Describes the upstream source corpus a rules pack was extracted from.
 * Importers populate this once per pack; per-record locators live on
 * `RulesRecord.provenance`. Exactly one of `sourceUrl` or `sourceIdentity`
 * must be set: `sourceUrl` for fetchable/canonical web sources,
 * `sourceIdentity` for vendored local corpora.
 */
export interface RulesPackSource {
  readonly sourceTitle: string;
  readonly sourceVersion: string;
  readonly sourceUrl?: string;
  readonly sourceIdentity?: string;
  /** SHA-256 (or equivalent) digest of the canonical source artifact. */
  readonly sourceHash?: string;
  /** ISO-8601 date the source artifact was published or snapshotted. */
  readonly sourceDate?: string;
  /**
   * Free-text policy describing how per-record `provenance` is populated for
   * this pack (e.g. "every record names the SRD page it was extracted from").
   */
  readonly recordProvenancePolicy: string;
}

/**
 * Per-record pointer back into the pack's source corpus. `sourceRef` must
 * match the owning pack's `meta.source.sourceUrl` or `meta.source.sourceIdentity`.
 * `locator` is a human-readable position in the source (page, section,
 * anchor) and is recommended but optional for sources that lack stable
 * locators.
 */
export interface RecordProvenance {
  readonly sourceRef: string;
  readonly locator?: string;
  readonly note?: string;
}

export interface RulesPackMeta {
  readonly packId: string;
  readonly title: string;
  readonly description: string;
  readonly role: RulesPackRole;
  readonly systemId: string;
  readonly version: string;
  readonly compatibleBaseSystems?: readonly CompatibleBaseSystem[];
  readonly order?: number;
  readonly dependsOn?: readonly string[];
  readonly license: RulesPackLicense;
  readonly source: RulesPackSource;
}

export interface RulesRecord {
  readonly systemId: string;
  readonly kind: RulesRecordKind;
  readonly key: string;
  readonly name: string;
  readonly data: unknown;
  /** Short human label for display (e.g. "SRD 5.1 p. 142"). Derived from `provenance`. */
  readonly source: string;
  readonly license: RulesPackLicense;
  readonly provenance: RecordProvenance;
  readonly overrides?: readonly string[];
}

export interface RulesPack {
  readonly meta: RulesPackMeta;
  readonly records: readonly RulesRecord[];
}

export class RulesPackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RulesPackError';
  }
}
