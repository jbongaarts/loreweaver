import { assertShippablePack, evaluatePackPolicy } from '../world/license.js';
import type { PackUsePolicy } from '../world/license.js';
import type { RulesPackLicense } from './types.js';
import { RulesPackError } from './types.js';

export type RulesPackUsePolicy = PackUsePolicy;

export function evaluateRulesPackPolicy(
  license: RulesPackLicense,
): RulesPackUsePolicy {
  return evaluatePackPolicy(license);
}

export function assertShippableRulesPack(license: RulesPackLicense): void {
  try {
    assertShippablePack(license);
  } catch (error) {
    if (error instanceof Error) {
      throw new RulesPackError(error.message);
    }
    throw error;
  }
}
