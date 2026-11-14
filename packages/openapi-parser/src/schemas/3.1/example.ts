import { Record as Rec, Schema } from "effect";
import { openApiObject } from "./object.ts";

export const OpenApiExample = openApiObject({
  summary: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  value: Schema.optionalKey(Schema.Unknown),
  externalValue: Schema.optionalKey(Schema.String),
}).check(
  Schema.makeFilter((value) =>
    Rec.has(value, "value") && value.externalValue !== undefined
      ? "Example value and externalValue are mutually exclusive"
      : undefined,
  ),
);

export type OpenApiExample = typeof OpenApiExample.Type;
