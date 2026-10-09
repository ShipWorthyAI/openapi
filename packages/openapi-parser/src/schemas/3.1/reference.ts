import { Schema } from "effect";
import { openApiObject } from "./object.ts";

export const OpenApiReference = openApiObject({
  $ref: Schema.String,
  summary: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
});

export type OpenApiReference = typeof OpenApiReference.Type;

/** Reference Objects are permitted only at the specification's reference positions. */
export function withReference<S extends Schema.Constraint>(schema: S) {
  return Schema.Union([OpenApiReference, schema]);
}
