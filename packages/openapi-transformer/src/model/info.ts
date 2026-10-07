import { Schema } from "effect";
import { ParsedExtensions } from "./extensions.js";
import { optionalString } from "./optional.js";

export const ParsedContact = Schema.Struct({
  name: optionalString,
  url: optionalString,
  email: optionalString,
  extensions: ParsedExtensions,
});

export type ParsedContact = typeof ParsedContact.Type;

export const ParsedLicense = Schema.Struct({
  name: Schema.String,
  url: optionalString,
  identifier: optionalString,
  extensions: ParsedExtensions,
});

export type ParsedLicense = typeof ParsedLicense.Type;
