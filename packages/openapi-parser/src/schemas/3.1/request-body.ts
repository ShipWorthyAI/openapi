import { Schema } from "effect";
import { OpenApiMediaType } from "./media-type.js";
import { openApiObject } from "./object.js";

export const OpenApiRequestBody = openApiObject({
  description: Schema.optionalKey(Schema.String),
  content: Schema.Record(Schema.String, OpenApiMediaType),
  required: Schema.optionalKey(Schema.Boolean),
});

export type OpenApiRequestBody = typeof OpenApiRequestBody.Type;
