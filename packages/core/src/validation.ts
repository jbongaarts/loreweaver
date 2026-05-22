type StringErrorConstructor = new (message: string) => Error;

export function requireNonEmpty(
  ErrorCtor: StringErrorConstructor,
  fields: ReadonlyArray<readonly [string, string]>,
  messageFor: (field: string) => string,
): void {
  for (const [field, value] of fields) {
    if (value.length === 0) {
      throw new ErrorCtor(messageFor(field));
    }
  }
}
