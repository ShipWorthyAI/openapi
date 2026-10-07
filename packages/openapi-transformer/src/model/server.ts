import { Schema } from "effect";
import { ParsedExtensions } from "./extensions.js";
import { node } from "./fields.js";
import { optionalField, optionalString } from "./optional.js";

export const ParsedServerVariable = Schema.Struct({
  default: Schema.String,
  enum: optionalField(Schema.Array(Schema.String)),
  description: optionalString,
  extensions: ParsedExtensions,
});

export type ParsedServerVariable = typeof ParsedServerVariable.Type;

export const ParsedServer = Schema.Struct({
  ...node,
  url: Schema.String,
  name: optionalString,
  description: optionalString,
  variables: optionalField(Schema.Record(Schema.String, ParsedServerVariable)),
});

export type ParsedServer = typeof ParsedServer.Type;
