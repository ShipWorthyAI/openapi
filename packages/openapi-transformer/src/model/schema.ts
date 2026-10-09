import { type JsonSchema, Schema } from "effect";

const parsedDiscriminatorFields = {
  propertyName: Schema.String,
  mapping: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
};

export interface ParsedDiscriminatorSchema extends Schema.Struct<
  typeof parsedDiscriminatorFields
> {}

/** The OpenAPI `discriminator` keyword of a schema. */
export const ParsedDiscriminator: ParsedDiscriminatorSchema =
  Schema.Struct(parsedDiscriminatorFields);

export type ParsedDiscriminator = typeof ParsedDiscriminator.Type;

/**
 * A JSON Schema Draft 2020-12 schema, the dialect of OpenAPI 3.1. `true` accepts anything and
 * `false` nothing. Bundling upgrades OpenAPI 3.0 schemas to this dialect, so the parser trusts the
 * keywords and checks only that a schema is an object or a boolean.
 */
export type ParsedSchema = JsonSchema.JsonSchema | boolean;

export const ParsedSchema: Schema.Codec<ParsedSchema> = Schema.Union([
  Schema.Record(Schema.String, Schema.Unknown),
  Schema.Boolean,
]);
