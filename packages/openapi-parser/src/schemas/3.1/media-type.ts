import { Record as Rec, Schema } from "effect";
import { OpenApiEncoding } from "./encoding.ts";
import { OpenApiExample } from "./example.ts";
import { openApiObject } from "./object.ts";
import { withReference } from "./reference.ts";
import { OpenApiSchema } from "./schema.ts";

export const OpenApiMediaType = openApiObject({
  schema: Schema.optionalKey(OpenApiSchema),
  example: Schema.optionalKey(Schema.Unknown),
  examples: Schema.optionalKey(Schema.Record(Schema.String, withReference(OpenApiExample))),
  encoding: Schema.optionalKey(Schema.Record(Schema.String, OpenApiEncoding)),
}).check(
  Schema.makeFilter((value) =>
    Rec.has(value, "example") && value.examples !== undefined
      ? "Media type example and examples are mutually exclusive"
      : undefined,
  ),
);

export type OpenApiMediaType = typeof OpenApiMediaType.Type;
