import { Schema } from "effect";
import { node, shareable } from "./fields.js";
import { optionalField, optionalString } from "./optional.js";

export const ParsedExample = Schema.Struct({
  ...node,
  ...shareable,
  /** The example's name. An `example` keyword becomes the example keyed `default`. */
  key: Schema.String,
  summary: optionalString,
  description: optionalString,
  value: optionalField(Schema.Unknown),
  externalValue: optionalString,
});

export type ParsedExample = typeof ParsedExample.Type;
