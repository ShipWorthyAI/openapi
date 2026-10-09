import { Schema } from "effect";
import { ParsedExample } from "./example.ts";
import { node, shareable } from "./fields.ts";
import { optionalField } from "./optional.ts";
import { ParsedSchema } from "./schema.ts";

const parsedMediaTypeFields = {
  ...node,
  ...shareable,
  mediaType: Schema.String,
  schema: optionalField(ParsedSchema),
  examples: Schema.Array(ParsedExample),
};

export interface ParsedMediaTypeSchema extends Schema.Struct<typeof parsedMediaTypeFields> {}

/** A media type of a parameter's or header's `content`. */
export const ParsedMediaType: ParsedMediaTypeSchema = Schema.Struct(parsedMediaTypeFields);

export interface ParsedMediaType extends Schema.Schema.Type<ParsedMediaTypeSchema> {}
