import { Schema } from "effect";
import { OpenApiComponents } from "./components.js";
import { OpenApiExternalDocs } from "./external-docs.js";
import { OpenApiInfo } from "./info.js";
import { openApiObject } from "./object.js";
import { OpenApiPathItem } from "./path-item.js";
import { OpenApiPaths } from "./paths.js";
import { OpenApiSchema } from "./schema.js";
import { OpenApiSecurityRequirement } from "./security-requirement.js";
import { OpenApiServer } from "./server.js";
import { OpenApiTag } from "./tag.js";

/** The OpenAPI 3.1 document produced after bundling and upgrading. */
export const ParsedOpenApi = openApiObject({
  openapi: Schema.String.check(Schema.isPattern(/^3\.1\.\d+(?:[-+].*)?$/)),
  info: OpenApiInfo,
  jsonSchemaDialect: Schema.optionalKey(Schema.String),
  servers: Schema.optionalKey(Schema.Array(OpenApiServer)),
  paths: Schema.optionalKey(OpenApiPaths),
  webhooks: Schema.optionalKey(Schema.Record(Schema.String, OpenApiPathItem)),
  components: Schema.optionalKey(OpenApiComponents),
  security: Schema.optionalKey(Schema.Array(OpenApiSecurityRequirement)),
  tags: Schema.optionalKey(Schema.Array(OpenApiTag)),
  externalDocs: Schema.optionalKey(OpenApiExternalDocs),
  $defs: Schema.optionalKey(Schema.Record(Schema.String, OpenApiSchema)),
});

export type ParsedOpenApi = typeof ParsedOpenApi.Type;
