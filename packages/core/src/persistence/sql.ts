/**
 * Quote a SQLite identifier. Callers must still choose identifiers from trusted
 * schema metadata or internal constants; this helper centralizes escaping so
 * those trusted names cannot accidentally break SQL syntax.
 */
export function quoteIdent(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}
