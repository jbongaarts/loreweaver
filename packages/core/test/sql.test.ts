import { describe, expect, it } from 'vitest';
import { quoteIdent } from '../src/persistence/sql.js';

describe('SQL helpers', () => {
  it('quotes identifiers and escapes embedded double quotes', () => {
    expect(quoteIdent('simple')).toBe('"simple"');
    expect(quoteIdent('table"name')).toBe('"table""name"');
  });
});
