import { Schema } from "effect";
import { ParsedExternalDocs } from "./external-docs.js";
import { node } from "./fields.js";
import { optionalField, optionalString } from "./optional.js";

export const ParsedTag = Schema.Struct({
  ...node,
  name: Schema.String,
  description: optionalString,
  /** Only set on tags the document declares. */
  externalDocs: optionalField(ParsedExternalDocs),
});

export type ParsedTag = typeof ParsedTag.Type;
