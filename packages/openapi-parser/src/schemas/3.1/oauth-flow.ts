import { Schema } from "effect";
import { openApiObject } from "./object.js";

export const OpenApiOAuthFlow = openApiObject({
  authorizationUrl: Schema.optionalKey(Schema.String),
  tokenUrl: Schema.optionalKey(Schema.String),
  refreshUrl: Schema.optionalKey(Schema.String),
  scopes: Schema.Record(Schema.String, Schema.String),
});

export type OpenApiOAuthFlow = typeof OpenApiOAuthFlow.Type;
