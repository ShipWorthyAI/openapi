import { Schema } from "effect";
import { ParsedExample } from "./example.js";
import { node, shareable } from "./fields.js";
import { ParsedMediaType } from "./media-type.js";
import { optionalBoolean, optionalField, optionalString } from "./optional.js";
import { ParamStyle } from "./param-style.js";
import { ParsedSchema } from "./schema.js";

/** A header. `name` is the key it is declared under; header styles are always `simple`. */
export const ParsedHeader = Schema.Struct({
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
});

export type ParsedHeader = typeof ParsedHeader.Type;
