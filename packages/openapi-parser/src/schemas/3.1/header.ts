import { Record as Rec, Schema } from "effect";
import { OpenApiExample } from "./example.ts";
import { OpenApiMediaType } from "./media-type.ts";
import { openApiObject } from "./object.ts";
import { withReference } from "./reference.ts";
import { OpenApiSchema } from "./schema.ts";

const fields = {
  description: Schema.optionalKey(Schema.String),
  required: Schema.optionalKey(Schema.Boolean),
  deprecated: Schema.optionalKey(Schema.Boolean),
  style: Schema.optionalKey(Schema.Literal("simple")),
  explode: Schema.optionalKey(Schema.Boolean),
  schema: Schema.optionalKey(OpenApiSchema),
  content: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.suspend((): Schema.Codec<OpenApiMediaType> => OpenApiMediaType),
    ),
  ),
  example: Schema.optionalKey(Schema.Unknown),
  examples: Schema.optionalKey(Schema.Record(Schema.String, withReference(OpenApiExample))),
};

/** The interface only ties the recursive knot; every field is inferred from its schema. */
export interface OpenApiHeader extends Schema.Struct.Type<typeof fields> {
  readonly [key: string]: unknown;
}

export const OpenApiHeader = openApiObject(fields).check(
  Schema.makeFilter((value) => {
    if ((value.schema === undefined) === (value.content === undefined)) {
      return "A header must have exactly one of schema or content";
    }

    if (value.content !== undefined && Rec.size(value.content) !== 1) {
      return "Header content must contain exactly one media type";
    }

    if (Rec.has(value, "example") && value.examples !== undefined) {
      return "Header example and examples are mutually exclusive";
    }

    return undefined;
  }),
);
