import { Schema } from "effect";
import { ParsedComponents } from "./components.js";
import { ParsedExternalDocs } from "./external-docs.js";
import { ParsedExtensions } from "./extensions.js";
import { node } from "./fields.js";
import { ParsedContact, ParsedLicense } from "./info.js";
import { optionalField, optionalString } from "./optional.js";
import { ParsedOperation } from "./operation.js";
import { ParsedPathItem } from "./path-item.js";
import { ParsedSchema } from "./schema.js";
import { ParsedSecurityRequirement, ParsedSecurityScheme } from "./security.js";
import { ParsedServer } from "./server.js";
import { ParsedTag } from "./tag.js";

/** The service: an OpenAPI document as an HTTP API. */
export const ParsedService = Schema.Struct({
  ...node,
  openapi: Schema.String,
  jsonSchemaDialect: optionalString,
  /** `info.title`. */
  name: Schema.String,
  /** `info.version`. */
  version: Schema.String,
  summary: optionalString,
  description: optionalString,
  termsOfService: optionalString,
  contact: optionalField(ParsedContact),
  license: optionalField(ParsedLicense),
  infoExtensions: ParsedExtensions,
  externalDocs: optionalField(ParsedExternalDocs),
  servers: Schema.Array(ParsedServer),
  /** Tags the document declares. */
  tags: Schema.Array(ParsedTag),
  security: Schema.Array(ParsedSecurityRequirement),
  securitySchemes: Schema.Record(Schema.String, ParsedSecurityScheme),
  /** Every operation under `paths`, in document order. */
  operations: Schema.Array(ParsedOperation),
  paths: Schema.Record(Schema.String, ParsedPathItem),
  webhooks: Schema.Record(Schema.String, ParsedPathItem),
  components: ParsedComponents,
  $defs: Schema.Record(Schema.String, ParsedSchema),
});

export type ParsedService = typeof ParsedService.Type;
