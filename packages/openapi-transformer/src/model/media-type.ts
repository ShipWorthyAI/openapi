import { Schema } from "effect";
import { ParsedExample } from "./example.js";
import { node, shareable } from "./fields.js";
import { optionalField } from "./optional.js";
import { ParsedSchema } from "./schema.js";

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
