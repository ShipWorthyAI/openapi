import { Schema } from "effect";
import { openApiObject } from "./object.ts";
import { OpenApiOperation } from "./operation.ts";
import { OpenApiParameter } from "./parameter.ts";
import { withReference } from "./reference.ts";
import { OpenApiServer } from "./server.ts";

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
