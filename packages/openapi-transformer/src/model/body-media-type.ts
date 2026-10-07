import { Schema } from "effect";
import { ParsedExtensions } from "./extensions.js";
import { ParsedHeader } from "./header.js";
import { ParsedMediaType } from "./media-type.js";
import { optionalBoolean, optionalString } from "./optional.js";
import { ParamStyle } from "./param-style.js";

export const ParsedEncoding = Schema.Struct({
  property: Schema.String,
  mediaType: optionalString,
  style: ParamStyle,
  explode: optionalBoolean,
  allowReserved: optionalBoolean,
  headers: Schema.Array(ParsedHeader),
  extensions: ParsedExtensions,
});

export type ParsedEncoding = typeof ParsedEncoding.Type;

/** A media type of a request or response body. Only bodies have encodings. */
export const ParsedBodyMediaType = Schema.Struct({
  ...ParsedMediaType.fields,
  encodings: Schema.Array(ParsedEncoding),
});

export type ParsedBodyMediaType = typeof ParsedBodyMediaType.Type;
