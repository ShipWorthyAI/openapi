import { Schema } from "effect";
import { node, shareable } from "./fields.js";
import { optionalField, optionalString } from "./optional.js";

const parsedExampleFields = {
  ...node,
  ...shareable,
  /** The example's name. An `example` keyword becomes the example keyed `default`. */
  key: Schema.String,
  summary: optionalString,
  description: optionalString,
  value: optionalField(Schema.Unknown),
  externalValue: optionalString,
};

export interface ParsedExampleSchema extends Schema.Struct<typeof parsedExampleFields> {}

export const ParsedExample: ParsedExampleSchema = Schema.Struct(parsedExampleFields);

export interface ParsedExample extends Schema.Schema.Type<ParsedExampleSchema> {}
