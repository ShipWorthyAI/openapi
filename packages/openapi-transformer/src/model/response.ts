import { Schema } from "effect";
import { ParsedBodyMediaType } from "./body-media-type.js";
import { node, shareable } from "./fields.js";
import { ParsedHeader } from "./header.js";
import { ParsedLink } from "./link.js";
import { optionalString } from "./optional.js";

const parsedResponseFields = {
  ...node,
  ...shareable,
  description: optionalString,
  headers: Schema.Array(ParsedHeader),
  contents: Schema.Array(ParsedBodyMediaType),
  links: Schema.Array(ParsedLink),
};

export interface ParsedResponseSchema extends Schema.Struct<typeof parsedResponseFields> {}

export const ParsedResponse: ParsedResponseSchema = Schema.Struct(parsedResponseFields);

export interface ParsedResponse extends Schema.Schema.Type<ParsedResponseSchema> {}

const parsedOperationResponseFields = {
  ...ParsedResponse.fields,
  /** A status code, a range such as `4XX`, or `default`. */
  code: Schema.String,
};

export interface ParsedOperationResponseSchema extends Schema.Struct<
  typeof parsedOperationResponseFields
> {}

export const ParsedOperationResponse: ParsedOperationResponseSchema = Schema.Struct(
  parsedOperationResponseFields,
);

export interface ParsedOperationResponse extends Schema.Schema.Type<ParsedOperationResponseSchema> {}
