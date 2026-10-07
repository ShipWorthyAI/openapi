import { Schema } from "effect";

/** Keep JSON Schema keywords and dialects intact; validate only the schema's object/boolean shape. */
export const OpenApiSchema = Schema.Union([
  Schema.Record(Schema.String, Schema.Unknown),
  Schema.Boolean,
]);

export type OpenApiSchema = typeof OpenApiSchema.Type;
