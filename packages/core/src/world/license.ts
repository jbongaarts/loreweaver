import type { PackLicense } from './types.js';
import { WorldModuleError } from './validate.js';

/**
 * Whether a pack may be bundled/published, hosted, and publicly shared.
 *
 * Policy (see `docs/architecture-report.md` content/licensing strategy):
 * bundled or public packs must be open, public-domain, original, or
 * publisher-licensed; `user-private` packs are never shippable. Closed-IP
 * derived material gated only by user ownership confirmation is rejected, so
 * trademarked setting material is shippable only when explicitly
 * publisher-licensed. Attribution is not a permission grant — the boolean
 * policy flags decide, `attributionText` only satisfies an attribution duty.
 */
export interface PackUsePolicy {
  readonly shippable: boolean;
  readonly hostedAllowed: boolean;
  readonly publicSharingAllowed: boolean;
  readonly reasons: readonly string[];
}

const SHIPPABLE_CLASSES = new Set([
  'open',
  'public-domain',
  'original',
  'publisher-licensed',
]);

export function evaluatePackPolicy(license: PackLicense): PackUsePolicy {
  const reasons: string[] = [];

  if (license.licenseClass === 'user-private') {
    reasons.push('user-private packs are not shipped or published');
  } else if (!SHIPPABLE_CLASSES.has(license.licenseClass)) {
    reasons.push(`license class '${license.licenseClass}' is not shippable`);
  }
  if (!license.redistributionAllowed) {
    reasons.push('redistribution is not allowed by the license');
  }
  if (!license.publicSharingAllowed) {
    reasons.push('public sharing is not allowed by the license');
  }
  if (
    license.containsTrademarkedSettingMaterial &&
    license.licenseClass !== 'publisher-licensed'
  ) {
    reasons.push(
      'contains trademarked setting material without a publisher license',
    );
  }

  return {
    shippable: reasons.length === 0,
    hostedAllowed:
      reasons.length === 0 && license.hostedUseAllowed,
    publicSharingAllowed:
      reasons.length === 0 && license.publicSharingAllowed,
    reasons,
  };
}

/**
 * Throw {@link WorldModuleError} unless the pack is shippable under
 * {@link evaluatePackPolicy}. Use this at bundle/publish boundaries.
 */
export function assertShippablePack(license: PackLicense): void {
  const policy = evaluatePackPolicy(license);
  if (!policy.shippable) {
    throw new WorldModuleError(
      `pack license is not shippable: ${policy.reasons.join('; ')}`,
    );
  }
}
