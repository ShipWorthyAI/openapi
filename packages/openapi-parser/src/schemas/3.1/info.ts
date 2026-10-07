import { Schema } from "effect";
import { OpenApiContact } from "./contact.js";
import { OpenApiLicense } from "./license.js";
import { openApiObject } from "./object.js";

export const OpenApiInfo = openApiObject({
  title: Schema.String,
  version: Schema.String,
  summary: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  termsOfService: Schema.optionalKey(Schema.String),
  contact: Schema.optionalKey(OpenApiContact),
  license: Schema.optionalKey(OpenApiLicense),
});

export type OpenApiInfo = typeof OpenApiInfo.Type;
