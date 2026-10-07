import { Schema } from "effect";
import { openApiObject } from "./object.js";
import { OpenApiOperation } from "./operation.js";
import { OpenApiParameter } from "./parameter.js";
import { withReference } from "./reference.js";
import { OpenApiServer } from "./server.js";

const operation = Schema.optionalKey(
  Schema.suspend((): Schema.Codec<OpenApiOperation> => OpenApiOperation),
);

export const OpenApiPathItem = openApiObject({
  $ref: Schema.optionalKey(Schema.String),
  summary: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  get: operation,
  put: operation,
  post: operation,
  delete: operation,
  options: operation,
  head: operation,
  patch: operation,
  trace: operation,
  servers: Schema.optionalKey(Schema.Array(OpenApiServer)),
  parameters: Schema.optionalKey(Schema.Array(withReference(OpenApiParameter))),
});

export type OpenApiPathItem = typeof OpenApiPathItem.Type;
