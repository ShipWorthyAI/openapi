import { Schema } from "effect";
import { ParsedHeader } from "./header.js";
import { optionalBoolean } from "./optional.js";

export const parameterLocations = ["path", "query", "header", "cookie"] as const;

export const ParameterLocation = Schema.Literals(parameterLocations);

export type ParameterLocation = typeof ParameterLocation.Type;

export const ParsedParameter = Schema.Struct({
  ...ParsedHeader.fields,
  in: ParameterLocation,
  allowEmptyValue: optionalBoolean,
  allowReserved: optionalBoolean,
});

export type ParsedParameter = typeof ParsedParameter.Type;
