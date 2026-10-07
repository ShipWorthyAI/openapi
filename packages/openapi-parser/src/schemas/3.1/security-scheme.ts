import { Schema } from "effect";
import { OpenApiOAuthFlows } from "./oauth-flows.js";
import { openApiObject } from "./object.js";

const description = Schema.optionalKey(Schema.String);

export const OpenApiSecurityScheme = Schema.Union([
  openApiObject({
    type: Schema.Literal("apiKey"),
    name: Schema.String,
    in: Schema.Literals(["query", "header", "cookie"]),
    description,
  }),
  openApiObject({
    type: Schema.Literal("http"),
    scheme: Schema.String,
    bearerFormat: Schema.optionalKey(Schema.String),
    description,
  }),
  openApiObject({ type: Schema.Literal("oauth2"), flows: OpenApiOAuthFlows, description }),
  openApiObject({
    type: Schema.Literal("openIdConnect"),
    openIdConnectUrl: Schema.String,
    description,
  }),
  openApiObject({ type: Schema.Literal("mutualTLS"), description }),
]);

export type OpenApiSecurityScheme = typeof OpenApiSecurityScheme.Type;
