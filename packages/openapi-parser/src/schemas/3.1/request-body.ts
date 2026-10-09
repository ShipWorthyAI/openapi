import { Schema } from "effect";
import { OpenApiMediaType } from "./media-type.ts";
import { openApiObject } from "./object.ts";

export const OpenApiRequestBody = openApiObject({
  description: Schema.optionalKey(Schema.String),
  content: Schema.Record(Schema.String, OpenApiMediaType),
  required: Schema.optionalKey(Schema.Boolean),
});

export type OpenApiRequestBody = typeof OpenApiRequestBody.Type;
