import { Schema } from "effect";
import { openApiObject } from "./object.js";

export const OpenApiContact = openApiObject({
  name: Schema.optionalKey(Schema.String),
  url: Schema.optionalKey(Schema.String),
  email: Schema.optionalKey(Schema.String),
});

export type OpenApiContact = typeof OpenApiContact.Type;
