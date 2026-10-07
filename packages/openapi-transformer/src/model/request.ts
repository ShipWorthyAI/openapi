import { Schema } from "effect";
import { ParsedBodyMediaType } from "./body-media-type.js";
import { node, shareable } from "./fields.js";
import { optionalField, optionalString } from "./optional.js";
import { ParsedParameter } from "./parameter.js";
import { ParsedRef } from "./reference.js";

export const ParsedRequestBody = Schema.Struct({
  ...node,
  ...shareable,
  description: optionalString,
  required: Schema.Boolean,
  contents: Schema.Array(ParsedBodyMediaType),
});

export type ParsedRequestBody = typeof ParsedRequestBody.Type;

/** Parameters grouped by location, in declaration order. */
export const ParsedParameters = Schema.Struct({
  path: Schema.Array(ParsedParameter),
  query: Schema.Array(ParsedParameter),
  headers: Schema.Array(ParsedParameter),
  cookie: Schema.Array(ParsedParameter),
  /** Parameter `$ref`s that point at nothing, so their location is unknown. */
  unknown: Schema.Array(ParsedRef),
});

export type ParsedParameters = typeof ParsedParameters.Type;

export const ParsedRequest = Schema.Struct({
  ...ParsedParameters.fields,
  body: optionalField(ParsedRequestBody),
});

export type ParsedRequest = typeof ParsedRequest.Type;
