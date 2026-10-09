import { Schema } from "effect";
import { ParsedExtensions } from "./extensions.ts";
import { optionalString } from "./optional.ts";

const parsedContactFields = {
  name: optionalString,
  url: optionalString,
  email: optionalString,
  extensions: ParsedExtensions,
};

export interface ParsedContactSchema extends Schema.Struct<typeof parsedContactFields> {}

export const ParsedContact: ParsedContactSchema = Schema.Struct(parsedContactFields);

export interface ParsedContact extends Schema.Schema.Type<ParsedContactSchema> {}

const parsedLicenseFields = {
  name: Schema.String,
  url: optionalString,
  identifier: optionalString,
  extensions: ParsedExtensions,
};

export interface ParsedLicenseSchema extends Schema.Struct<typeof parsedLicenseFields> {}

export const ParsedLicense: ParsedLicenseSchema = Schema.Struct(parsedLicenseFields);

export interface ParsedLicense extends Schema.Schema.Type<ParsedLicenseSchema> {}
