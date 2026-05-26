import type { ResolvedRulesStack, RulesStackRecordSource } from './stack.js';
import { normalizeRulesRecordName } from './stack.js';
import type {
  RulesPackLicense,
  RulesPackMeta,
  RulesRecord,
  RulesRecordKind,
} from './types.js';

export type RulesLookupInput =
  | {
      readonly kind: RulesRecordKind;
      readonly ref: string;
      readonly name?: never;
    }
  | {
      readonly kind: RulesRecordKind;
      readonly name: string;
      readonly ref?: never;
    };

export type RulesLookupResult =
  | {
      readonly ok: true;
      readonly record: RulesRecord;
      readonly pack: RulesPackMeta;
      readonly license: RulesPackLicense;
      readonly overrideChain: readonly RulesStackRecordSource[];
    }
  | {
      readonly ok: false;
      readonly code: 'not_found';
      readonly message: string;
    };

export function lookupRulesRecord(
  stack: ResolvedRulesStack,
  input: RulesLookupInput,
): RulesLookupResult {
  const kindIndex = stack.recordsByKind.get(input.kind);
  const entry =
    input.ref !== undefined
      ? kindIndex?.byKey.get(input.ref)
      : kindIndex?.byName.get(normalizeRulesRecordName(input.name));

  if (entry === undefined) {
    return {
      ok: false,
      code: 'not_found',
      message: `No rules ${input.kind} found for ${describeLookupInput(input)}.`,
    };
  }

  return {
    ok: true,
    record: entry.record,
    pack: entry.pack.meta,
    license: entry.license,
    overrideChain: entry.overrideChain,
  };
}

function describeLookupInput(input: RulesLookupInput): string {
  if (input.ref !== undefined) {
    return `ref ${input.ref}`;
  }

  return `name ${input.name}`;
}
