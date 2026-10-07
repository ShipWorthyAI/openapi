import { Schema } from "effect";
import { OpenApiOAuthFlow } from "./oauth-flow.js";
import { openApiObject } from "./object.js";

export const OpenApiOAuthFlows = openApiObject({
  implicit: Schema.optionalKey(
    openApiObject({ ...OpenApiOAuthFlow.schema.fields, authorizationUrl: Schema.String }),
  ),
  password: Schema.optionalKey(
    openApiObject({ ...OpenApiOAuthFlow.schema.fields, tokenUrl: Schema.String }),
  ),
  clientCredentials: Schema.optionalKey(
    openApiObject({ ...OpenApiOAuthFlow.schema.fields, tokenUrl: Schema.String }),
  ),
  authorizationCode: Schema.optionalKey(
    openApiObject({
      ...OpenApiOAuthFlow.schema.fields,
      authorizationUrl: Schema.String,
      tokenUrl: Schema.String,
    }),
  ),
});

export type OpenApiOAuthFlows = typeof OpenApiOAuthFlows.Type;
