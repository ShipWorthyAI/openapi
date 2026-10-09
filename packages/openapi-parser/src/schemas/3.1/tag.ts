import { Schema } from "effect";
import { OpenApiExternalDocs } from "./external-docs.ts";
import { openApiObject } from "./object.ts";

export const OpenApiTag = openApiObject({
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  externalDocs: Schema.optionalKey(OpenApiExternalDocs),
});

export type OpenApiTag = typeof OpenApiTag.Type;
