import { Schema } from "effect";
import { ParsedExtensions } from "./extensions.js";
import { node } from "./fields.js";
import { optionalField, optionalString } from "./optional.js";

const parsedServerVariableFields = {
  default: Schema.String,
  enum: optionalField(Schema.Array(Schema.String)),
  description: optionalString,
  extensions: ParsedExtensions,
};

export interface ParsedServerVariableSchema extends Schema.Struct<
  typeof parsedServerVariableFields
> {}

export const ParsedServerVariable: ParsedServerVariableSchema = Schema.Struct(
  parsedServerVariableFields,
);

export interface ParsedServerVariable extends Schema.Schema.Type<ParsedServerVariableSchema> {}

const parsedServerFields = {
  ...node,
  url: Schema.String,
  name: optionalString,
  description: optionalString,
  variables: optionalField(Schema.Record(Schema.String, ParsedServerVariable)),
};

export interface ParsedServerSchema extends Schema.Struct<typeof parsedServerFields> {}

export const ParsedServer: ParsedServerSchema = Schema.Struct(parsedServerFields);

export interface ParsedServer extends Schema.Schema.Type<ParsedServerSchema> {}
