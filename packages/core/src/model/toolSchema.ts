/**
 * Provider-neutral tool schema vocabulary (loreweaver-0jq.10).
 *
 * The deterministic tool layer is the canonical owner of a tool's input
 * contract; the DM model speaks to tools through fenced text today and may
 * speak through native provider tool channels tomorrow. To make both routes
 * possible without coupling the core to any provider SDK, every bundled tool
 * publishes a JSON-Schema-shaped {@link ToolInputSchema} alongside its name
 * and description.
 *
 * The dialect here is a deliberate, conservative subset of JSON Schema Draft
 * 2020-12 chosen so it can be lifted directly into:
 *   - Anthropic `tools[].input_schema`
 *   - OpenAI `tools[].function.parameters`
 *   - Bedrock Anthropic-flavored `inputSchema.json`
 * without translation. Provider-specific or expensive keywords
 * (`$ref` resolution, `if`/`then`/`else`, `$dynamicRef`, ...) are intentionally
 * omitted — adapters can add them later if a real need shows up.
 *
 * This module deliberately has NO provider imports and NO orchestrator
 * imports; both layers may depend on it.
 */

/** A primitive or composite JSON-Schema type tag. */
export type JsonSchemaType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'object'
  | 'array'
  | 'null';

/**
 * A JSON-Schema-like fragment. All fields are optional so this can describe a
 * scalar leaf (`{ type: 'string' }`), a single object property, a `oneOf`
 * branch, or a full schema root.
 *
 * The subset covers the keywords every supported provider tool-schema dialect
 * recognises. Unknown keywords on a `JsonSchema` value are permitted by the
 * structural type but ignored by the core; adapters that target a richer
 * dialect can read them.
 */
export interface JsonSchema {
  readonly type?: JsonSchemaType | readonly JsonSchemaType[];
  readonly description?: string;
  readonly enum?: readonly (string | number | boolean | null)[];

  // object
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | JsonSchema;

  // array
  readonly items?: JsonSchema;
  readonly minItems?: number;
  readonly maxItems?: number;

  // string
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;

  // number
  readonly minimum?: number;
  readonly maximum?: number;

  // composition
  readonly oneOf?: readonly JsonSchema[];
  readonly anyOf?: readonly JsonSchema[];
}

/**
 * The input schema of a tool — always an object schema at the root. Every
 * supported provider expects tool inputs to be objects, so this narrowing
 * matches both the fenced-text protocol (`args: { ... }`) and native tool
 * channels.
 */
export interface ToolInputSchema extends JsonSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

/**
 * Provider-neutral tool definition exposed to ModelClients. Mirrors the
 * (`name`, `description`) fields already on a {@link Tool} and adds the
 * declarative input schema so adapters can render native tool calls. Lifted
 * straight out of {@link ToolRegistry.definitions} — there is no separate
 * registration ceremony.
 */
export interface ModelToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolInputSchema;
}
