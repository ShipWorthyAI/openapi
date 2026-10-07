import { Schema } from "effect";
import { ParsedExtensions } from "./extensions.js";
import { optionalString } from "./optional.js";

export const ParsedExternalDocs = Schema.Struct({
  url: Schema.String,
  description: optionalString,
  extensions: ParsedExtensions,
});

export type ParsedExternalDocs = typeof ParsedExternalDocs.Type;
