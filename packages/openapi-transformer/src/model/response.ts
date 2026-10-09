import { Schema } from "effect";
import { ParsedBodyMediaType } from "./body-media-type.ts";
import { node, shareable } from "./fields.ts";
import { ParsedHeader } from "./header.ts";
import { ParsedLink } from "./link.ts";
import { optionalString } from "./optional.ts";

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
