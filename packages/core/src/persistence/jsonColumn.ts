/**
 * Typed codec for a JSON-backed SQLite text column.
 *
 * Every JSON-backed column would otherwise repeat an inline `JSON.stringify`
 * on write and a `JSON.parse(...) as T` (unchecked cast) on read, scattered
 * across each persistence module. A {@link JsonColumn} gives a column one
 * typed encode/decode boundary with consistent, labelled errors.
 */

export class JsonColumnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonColumnError';
  }
}

export interface JsonColumn<T> {
  /**
   * Serialize a value for storage. Throws {@link JsonColumnError} when `value`
   * is not JSON-serializable (a BigInt, a circular structure, or an
   * `undefined` / function / symbol).
   */
  encode(value: T): string;
  /**
   * Parse a stored column value back to `T`. Throws {@link JsonColumnError} on
   * invalid JSON. The cast to `T` is unchecked — `T` must match the shape the
   * column stores.
   */
  decode(raw: string): T;
}

/**
 * Build a {@link JsonColumn} codec. `label` names the column in error messages
 * (e.g. `'turn_trace.tool_calls'`).
 */
export function jsonColumn<T>(label: string): JsonColumn<T> {
  return {
    encode(value: T): string {
      let serialized: string | undefined;
      try {
        serialized = JSON.stringify(value);
      } catch {
        // JSON.stringify throws on a BigInt or a circular structure.
        serialized = undefined;
      }
      if (serialized === undefined) {
        // A plain `undefined` result also covers `undefined` / function /
        // symbol values, which JSON.stringify drops rather than throws on.
        throw new JsonColumnError(`${label} is not JSON-serializable`);
      }
      return serialized;
    },
    decode(raw: string): T {
      try {
        return JSON.parse(raw) as T;
      } catch {
        throw new JsonColumnError(`${label} is not valid JSON`);
      }
    },
  };
}
