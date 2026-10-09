import { Schema } from "effect";
import { ParsedExample } from "./example.ts";
import { node, shareable } from "./fields.ts";
import { ParsedMediaType } from "./media-type.ts";
import { optionalBoolean, optionalField, optionalString } from "./optional.ts";
import { ParamStyle } from "./param-style.ts";
import { ParsedSchema } from "./schema.ts";

const parsedHeaderFields = {
  ...node,
  ...shareable,
  name: Schema.String,
  style: ParamStyle,
  explode: optionalBoolean,
  required: Schema.Boolean,
  deprecated: Schema.Boolean,
  description: optionalString,
  schema: optionalField(ParsedSchema),
  /** Set when the value uses `content` instead of `schema`. */
  contents: Schema.Array(ParsedMediaType),
  examples: Schema.Array(ParsedExample),
};

export interface ParsedHeaderSchema extends Schema.Struct<typeof parsedHeaderFields> {}

/** A header. `name` is the key it is declared under; header styles are always `simple`. */
export const ParsedHeader: ParsedHeaderSchema = Schema.Struct(parsedHeaderFields);

export interface ParsedHeader extends Schema.Schema.Type<ParsedHeaderSchema> {}
