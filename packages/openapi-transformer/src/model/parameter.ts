import { Schema } from "effect";
import { ParsedHeader } from "./header.ts";
import { optionalBoolean } from "./optional.ts";

export const parameterLocations = ["path", "query", "header", "cookie"] as const;

export const ParameterLocation = Schema.Literals(parameterLocations);

export type ParameterLocation = typeof ParameterLocation.Type;

const parsedParameterFields = {
  ...ParsedHeader.fields,
  in: ParameterLocation,
  allowEmptyValue: optionalBoolean,
  allowReserved: optionalBoolean,
};

export interface ParsedParameterSchema extends Schema.Struct<typeof parsedParameterFields> {}

export const ParsedParameter: ParsedParameterSchema = Schema.Struct(parsedParameterFields);

export interface ParsedParameter extends Schema.Schema.Type<ParsedParameterSchema> {}
