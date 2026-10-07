import { Schema } from "effect";
import { openApiObject } from "./object.js";

export const OpenApiServerVariable = openApiObject({
  default: Schema.String,
  enum: Schema.optionalKey(Schema.NonEmptyArray(Schema.String)),
  description: Schema.optionalKey(Schema.String),
});

export type OpenApiServerVariable = typeof OpenApiServerVariable.Type;
