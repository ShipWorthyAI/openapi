import { Schema } from "effect";
import { openApiObject } from "./object.ts";

export const OpenApiExternalDocs = openApiObject({
  url: Schema.String,
  description: Schema.optionalKey(Schema.String),
});

export type OpenApiExternalDocs = typeof OpenApiExternalDocs.Type;
