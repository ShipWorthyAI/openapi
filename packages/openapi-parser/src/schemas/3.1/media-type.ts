import { Schema } from "effect";
import { OpenApiEncoding } from "./encoding.js";
import { OpenApiExample } from "./example.js";
import { openApiObject } from "./object.js";
import { withReference } from "./reference.js";
import { OpenApiSchema } from "./schema.js";

export const OpenApiMediaType = openApiObject({
  schema: Schema.optionalKey(OpenApiSchema),
  example: Schema.optionalKey(Schema.Unknown),
  examples: Schema.optionalKey(Schema.Record(Schema.String, withReference(OpenApiExample))),
  encoding: Schema.optionalKey(Schema.Record(Schema.String, OpenApiEncoding)),
}).check(
  Schema.makeFilter((value) =>
    Object.hasOwn(value, "example") && value.examples !== undefined
      ? "Media type example and examples are mutually exclusive"
      : undefined,
  ),
);

export type OpenApiMediaType = typeof OpenApiMediaType.Type;
