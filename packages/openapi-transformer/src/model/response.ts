import { Schema } from "effect";
import { ParsedBodyMediaType } from "./body-media-type.js";
import { node, shareable } from "./fields.js";
import { ParsedHeader } from "./header.js";
import { ParsedLink } from "./link.js";
import { optionalString } from "./optional.js";

export const ParsedResponse = Schema.Struct({
  ...node,
  ...shareable,
  description: optionalString,
  headers: Schema.Array(ParsedHeader),
  contents: Schema.Array(ParsedBodyMediaType),
  links: Schema.Array(ParsedLink),
});

export type ParsedResponse = typeof ParsedResponse.Type;

export const ParsedOperationResponse = Schema.Struct({
  ...ParsedResponse.fields,
  /** A status code, a range such as `4XX`, or `default`. */
  code: Schema.String,
});

export type ParsedOperationResponse = typeof ParsedOperationResponse.Type;
