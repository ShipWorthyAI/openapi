import { Schema } from "effect";
import { ParsedBodyMediaType } from "./body-media-type.js";
import { node, shareable } from "./fields.js";
import { optionalField, optionalString } from "./optional.js";
import { ParsedParameter } from "./parameter.js";
import { ParsedRef } from "./reference.js";

const parsedRequestBodyFields = {
  ...node,
  ...shareable,
  description: optionalString,
  required: Schema.Boolean,
  contents: Schema.Array(ParsedBodyMediaType),
};

export interface ParsedRequestBodySchema extends Schema.Struct<typeof parsedRequestBodyFields> {}

export const ParsedRequestBody: ParsedRequestBodySchema = Schema.Struct(parsedRequestBodyFields);

export interface ParsedRequestBody extends Schema.Schema.Type<ParsedRequestBodySchema> {}

const parsedParametersFields = {
  path: Schema.Array(ParsedParameter),
  query: Schema.Array(ParsedParameter),
  headers: Schema.Array(ParsedParameter),
  cookie: Schema.Array(ParsedParameter),
  /** Parameter `$ref`s that point at nothing, so their location is unknown. */
  unknown: Schema.Array(ParsedRef),
};

export interface ParsedParametersSchema extends Schema.Struct<typeof parsedParametersFields> {}

/** Parameters grouped by location, in declaration order. */
export const ParsedParameters: ParsedParametersSchema = Schema.Struct(parsedParametersFields);

export interface ParsedParameters extends Schema.Schema.Type<ParsedParametersSchema> {}

const parsedRequestFields = {
  ...ParsedParameters.fields,
  body: optionalField(ParsedRequestBody),
};

export interface ParsedRequestSchema extends Schema.Struct<typeof parsedRequestFields> {}

export const ParsedRequest: ParsedRequestSchema = Schema.Struct(parsedRequestFields);

export interface ParsedRequest extends Schema.Schema.Type<ParsedRequestSchema> {}
