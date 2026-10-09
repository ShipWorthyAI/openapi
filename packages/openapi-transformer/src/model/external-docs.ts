import { Schema } from "effect";
import { ParsedExtensions } from "./extensions.js";
import { optionalString } from "./optional.js";

const parsedExternalDocsFields = {
  url: Schema.String,
  description: optionalString,
  extensions: ParsedExtensions,
};

export interface ParsedExternalDocsSchema extends Schema.Struct<typeof parsedExternalDocsFields> {}

export const ParsedExternalDocs: ParsedExternalDocsSchema = Schema.Struct(parsedExternalDocsFields);

export interface ParsedExternalDocs extends Schema.Schema.Type<ParsedExternalDocsSchema> {}
