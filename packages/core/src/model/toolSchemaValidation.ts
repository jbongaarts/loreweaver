import type { JsonSchema, ToolInputSchema } from './toolSchema.js';

function valueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && Number.isInteger(value)) return 'integer';
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return (
        typeof value === 'object' && value !== null && !Array.isArray(value)
      );
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    default:
      return typeof value === type;
  }
}

function validateComposition(
  schema: JsonSchema,
  value: unknown,
  path: string,
): string | undefined {
  if (schema.oneOf) {
    const matches = schema.oneOf.filter(
      (candidate) => validateJsonSchema(candidate, value, path) === undefined,
    ).length;
    if (matches !== 1) {
      return `${path} must match exactly one allowed schema`;
    }
  }
  if (
    schema.anyOf &&
    !schema.anyOf.some(
      (candidate) => validateJsonSchema(candidate, value, path) === undefined,
    )
  ) {
    return `${path} must match at least one allowed schema`;
  }
  return undefined;
}

/**
 * Validate a value against the conservative JSON Schema subset Eshyra exposes
 * to model providers. Returns the first actionable error, or undefined.
 */
export function validateJsonSchema(
  schema: JsonSchema,
  value: unknown,
  path = 'args',
): string | undefined {
  const compositionError = validateComposition(schema, value, path);
  if (compositionError) return compositionError;

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      return `${path} must be ${types.join(' or ')}, received ${valueType(value)}`;
    }
  }

  if (
    schema.enum &&
    !schema.enum.some((candidate) => Object.is(candidate, value))
  ) {
    return `${path} must be one of ${schema.enum.map(String).join(', ')}`;
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return `${path} must have length >= ${schema.minLength}`;
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      return `${path} must have length <= ${schema.maxLength}`;
    }
    if (
      schema.pattern !== undefined &&
      !new RegExp(schema.pattern).test(value)
    ) {
      return `${path} must match ${schema.pattern}`;
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      return `${path} must be >= ${schema.minimum}`;
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      return `${path} must be <= ${schema.maximum}`;
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      return `${path} must contain at least ${schema.minItems} items`;
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      return `${path} must contain at most ${schema.maxItems} items`;
    }
    if (schema.items) {
      for (const [index, item] of value.entries()) {
        const error = validateJsonSchema(
          schema.items,
          item,
          `${path}[${index}]`,
        );
        if (error) return error;
      }
    }
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(record, required)) {
        return `${path}.${required} is required`;
      }
    }
    const properties = schema.properties ?? {};
    for (const [key, propertyValue] of Object.entries(record)) {
      const propertySchema = properties[key];
      if (propertySchema) {
        const error = validateJsonSchema(
          propertySchema,
          propertyValue,
          `${path}.${key}`,
        );
        if (error) return error;
        continue;
      }
      if (schema.additionalProperties === false) {
        return `${path}.${key} is not allowed`;
      }
      if (
        typeof schema.additionalProperties === 'object' &&
        schema.additionalProperties !== null
      ) {
        const error = validateJsonSchema(
          schema.additionalProperties,
          propertyValue,
          `${path}.${key}`,
        );
        if (error) return error;
      }
    }
  }

  return undefined;
}

export function validateToolInput(
  schema: ToolInputSchema,
  args: unknown,
): string | undefined {
  return validateJsonSchema(schema, args);
}
