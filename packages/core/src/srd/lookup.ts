import type { SrdLookupInput, SrdLookupResult } from './types.js';
import { lookupSrdRecord } from './store.js';

export function lookupSrd(input: SrdLookupInput): SrdLookupResult {
  return lookupSrdRecord(input);
}
