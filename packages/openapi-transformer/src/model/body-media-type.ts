import { Schema } from "effect";
import { ParsedExtensions } from "./extensions.js";
import { ParsedHeader } from "./header.js";
import { ParsedMediaType } from "./media-type.js";
import { optionalBoolean, optionalString } from "./optional.js";
import { ParamStyle } from "./param-style.js";

const parsedEncodingFields = {
  property: Schema.String,
  mediaType: optionalString,
  style: ParamStyle,
  explode: optionalBoolean,
  allowReserved: optionalBoolean,
  headers: Schema.Array(ParsedHeader),
  extensions: ParsedExtensions,
};

export interface ParsedEncodingSchema extends Schema.Struct<typeof parsedEncodingFields> {}

export const ParsedEncoding: ParsedEncodingSchema = Schema.Struct(parsedEncodingFields);

export interface ParsedEncoding extends Schema.Schema.Type<ParsedEncodingSchema> {}

const parsedBodyMediaTypeFields = {
  ...ParsedMediaType.fields,
  encodings: Schema.Array(ParsedEncoding),
};

export interface ParsedBodyMediaTypeSchema extends Schema.Struct<
  typeof parsedBodyMediaTypeFields
> {}

/** A media type of a request or response body. Only bodies have encodings. */
export const ParsedBodyMediaType: ParsedBodyMediaTypeSchema =
  Schema.Struct(parsedBodyMediaTypeFields);

export interface ParsedBodyMediaType extends Schema.Schema.Type<ParsedBodyMediaTypeSchema> {}
