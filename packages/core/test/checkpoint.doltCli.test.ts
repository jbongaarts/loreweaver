import { describe, expect, it } from 'vitest';
import { sqlLiteral } from '../src/persistence/checkpoint/doltCli.js';

describe('sqlLiteral', () => {
  it('wraps the string in single quotes', () => {
    expect(sqlLiteral('hello')).toBe("'hello'");
  });

  it("doubles a single quote (it can't → 'it can''t')", () => {
    expect(sqlLiteral("it can't")).toBe("'it can''t'");
  });

  it("escapes a backslash (a\\b → 'a\\\\b')", () => {
    // Source string is the two characters: a  \  b
    // Expected output:  '  a  \\  b  '  (the backslash is doubled)
    expect(sqlLiteral('a\\b')).toBe("'a\\\\b'");
  });

  it('regression guard: JSON-style \\n (backslash + n) stays two characters', () => {
    // A payload containing the two-character sequence backslash-n — which is
    // what JSON encoding produces for fields that hold newlines — must NOT
    // collapse to a real newline character after dolt processes the literal.
    // Without escaping backslashes first, dolt/MySQL would interpret `\n` as
    // a real newline and silently corrupt every stored value that came from
    // JSON-encoded text.
    //
    // Source string: the two characters  \  n
    // Expected SQL literal:  '  \\  n  '  (backslash doubled, n unchanged)
    expect(sqlLiteral('\\n')).toBe("'\\\\n'");
  });

  it('escapes both a single quote and a backslash in the same string', () => {
    // Source: it's\done  (apostrophe + backslash)
    // Expected: 'it''s\\done'
    expect(sqlLiteral("it's\\done")).toBe("'it''s\\\\done'");
  });
});
