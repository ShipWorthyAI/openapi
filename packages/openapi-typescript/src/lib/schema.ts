import { type ParsedSchema, ParsedDiscriminator } from "@shipworthy/openapi-transformer";
import { Array as Arr, Option, Predicate, Record, Schema } from "effect";

// The parser trusts the keywords of a bundled schema, so these narrow a keyword's value before it
// is used. Each returns `undefined` when the keyword is missing or has another shape.

export function isSchema(value: unknown): value is ParsedSchema {
  return Predicate.isBoolean(value) || Predicate.isObject(value);
}

/** A keyword that holds one schema, such as `items` or `additionalProperties`. */
export function subschema(value: unknown): ParsedSchema | undefined {
  return isSchema(value) ? value : undefined;
}

/** A keyword that holds a list of schemas, such as `allOf` or `prefixItems`. */
export function subschemaList(value: unknown): ParsedSchema[] | undefined {
  return Arr.isArray(value) ? Arr.filter(value, isSchema) : undefined;
}

/** A keyword that holds schemas by name, such as `properties` or `$defs`. */
export function subschemaMap(value: unknown): Record<string, ParsedSchema> | undefined {
  if (!Predicate.isObject(value)) return undefined;

  return Record.filter(value, isSchema);
}

/** A keyword that holds a list of strings, such as `required` or a list of `type`s. */
export function stringList(value: unknown): string[] | undefined {
  return Arr.isArray(value) ? Arr.filter(value, Predicate.isString) : undefined;
}

const decodeDiscriminator = Schema.decodeUnknownOption(ParsedDiscriminator);

/** The OpenAPI `discriminator` keyword. */
export function discriminatorOf(value: unknown): ParsedDiscriminator | undefined {
  return Option.getOrUndefined(decodeDiscriminator(value));
}
