import { describe, expect, it } from 'vitest';
import { requireNonEmpty } from '../src/validation.js';

class TestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestValidationError';
  }
}

describe('validation helpers', () => {
  it('throws the provided error class for empty required fields', () => {
    expect(() =>
      requireNonEmpty(TestValidationError, [['name', '']], (field) => {
        return `demo ${field} is required`;
      }),
    ).toThrow(TestValidationError);
  });

  it('accepts non-empty strings', () => {
    expect(() =>
      requireNonEmpty(TestValidationError, [['name', 'Mira']], (field) => {
        return `demo ${field} is required`;
      }),
    ).not.toThrow();
  });
});
