import { Schema } from "effect";
import { openApiObject } from "./object.ts";
import { OpenApiServerVariable } from "./server-variable.ts";

export const OpenApiServer = openApiObject({
  url: Schema.String,
  description: Schema.optionalKey(Schema.String),
  variables: Schema.optionalKey(Schema.Record(Schema.String, OpenApiServerVariable)),
});

export type OpenApiServer = typeof OpenApiServer.Type;
