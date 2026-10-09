import { Schema } from "effect";
import { OpenApiComponents } from "./components.ts";
import { OpenApiExternalDocs } from "./external-docs.ts";
import { OpenApiInfo } from "./info.ts";
import { openApiObject } from "./object.ts";
import { OpenApiPathItem } from "./path-item.ts";
import { OpenApiPaths } from "./paths.ts";
import { OpenApiSchema } from "./schema.ts";
import { OpenApiSecurityRequirement } from "./security-requirement.ts";
import { OpenApiServer } from "./server.ts";
import { OpenApiTag } from "./tag.ts";

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
