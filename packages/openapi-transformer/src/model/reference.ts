import { Schema } from "effect";
import { optionalString } from "./optional.ts";

const parsedRefFields = {
  $ref: Schema.String,
  summary: optionalString,
  description: optionalString,
};

export interface ParsedRefSchema extends Schema.Struct<typeof parsedRefFields> {}

/** A Reference Object as written. `unknown` parameters are ones whose target is missing. */
export const ParsedRef: ParsedRefSchema = Schema.Struct(parsedRefFields);

export interface ParsedRef extends Schema.Schema.Type<ParsedRefSchema> {}
