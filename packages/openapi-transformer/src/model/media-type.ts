import { Schema } from "effect";
import { ParsedExample } from "./example.js";
import { node, shareable } from "./fields.js";
import { optionalField } from "./optional.js";
import { ParsedSchema } from "./schema.js";

/** A media type of a parameter's or header's `content`. */
export const ParsedMediaType = Schema.Struct({
  ...node,
  ...shareable,
  mediaType: Schema.String,
  schema: optionalField(ParsedSchema),
  examples: Schema.Array(ParsedExample),
});

export type ParsedMediaType = typeof ParsedMediaType.Type;
