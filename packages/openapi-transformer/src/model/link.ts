import { Schema } from "effect";
import { node, shareable } from "./fields.ts";
import { optionalField, optionalString } from "./optional.ts";

const parsedLinkFields = {
  ...node,
  ...shareable,
  key: Schema.String,
  operationRef: optionalString,
  operationId: optionalString,
  parameters: optionalField(Schema.Record(Schema.String, Schema.Unknown)),
  requestBody: optionalField(Schema.Unknown),
  description: optionalString,
};

export interface ParsedLinkSchema extends Schema.Struct<typeof parsedLinkFields> {}

export const ParsedLink: ParsedLinkSchema = Schema.Struct(parsedLinkFields);

export interface ParsedLink extends Schema.Schema.Type<ParsedLinkSchema> {}
