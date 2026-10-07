import { Schema } from "effect";
import { optionalString } from "./optional.js";

/** A Reference Object as written. `unknown` parameters are ones whose target is missing. */
export const ParsedRef = Schema.Struct({
  $ref: Schema.String,
  summary: optionalString,
  description: optionalString,
});

export type ParsedRef = typeof ParsedRef.Type;
