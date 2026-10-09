import { Schema } from "effect";
import { ParsedExternalDocs } from "./external-docs.js";
import { node } from "./fields.js";
import { optionalField, optionalString } from "./optional.js";

const parsedTagFields = {
  ...node,
  name: Schema.String,
  description: optionalString,
  /** Only set on tags the document declares. */
  externalDocs: optionalField(ParsedExternalDocs),
};

export interface ParsedTagSchema extends Schema.Struct<typeof parsedTagFields> {}

export const ParsedTag: ParsedTagSchema = Schema.Struct(parsedTagFields);

export interface ParsedTag extends Schema.Schema.Type<ParsedTagSchema> {}
