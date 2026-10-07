import { JsonSchema, Predicate } from "effect";
import type { ParsedSchema } from "../types.js";

function isJsonSchema(value: unknown): value is JsonSchema.JsonSchema {
  return Predicate.isObject(value);
}

export function schemaNode(value: unknown): ParsedSchema | undefined {
  if (Predicate.isBoolean(value)) return value;
  if (isJsonSchema(value)) return value;
  return undefined;
}

export function schemaMap(value: unknown): Readonly<Record<string, ParsedSchema>> {
  if (!Predicate.isObject(value)) return {};
  const record: Record<string, ParsedSchema> = {};

  for (const [key, entry] of Object.entries(value)) {
    const schema = schemaNode(entry);
    if (schema !== undefined) record[key] = schema;
  }

  return record;
}
