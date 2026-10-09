import { Schema } from "effect";
import { ParsedExtensions } from "./extensions.ts";
import { optionalString } from "./optional.ts";

const parsedExternalDocsFields = {
  url: Schema.String,
  description: optionalString,
  extensions: ParsedExtensions,
};

export interface ParsedExternalDocsSchema extends Schema.Struct<typeof parsedExternalDocsFields> {}

export const ParsedExternalDocs: ParsedExternalDocsSchema = Schema.Struct(parsedExternalDocsFields);

export interface ParsedExternalDocs extends Schema.Schema.Type<ParsedExternalDocsSchema> {}
