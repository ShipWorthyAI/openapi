import { Schema } from "effect";
import { ParsedComponents } from "./components.ts";
import { ParsedExternalDocs } from "./external-docs.ts";
import { ParsedExtensions } from "./extensions.ts";
import { node } from "./fields.ts";
import { ParsedContact, ParsedLicense } from "./info.ts";
import { optionalField, optionalString } from "./optional.ts";
import { ParsedOperation } from "./operation.ts";
import { ParsedPathItem } from "./path-item.ts";
import { ParsedSchema } from "./schema.ts";
import { ParsedSecurityRequirement, ParsedSecurityScheme } from "./security.ts";
import { ParsedServer } from "./server.ts";
import { ParsedTag } from "./tag.ts";

const parsedServiceFields = {
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
};

export interface ParsedServiceSchema extends Schema.Struct<typeof parsedServiceFields> {}

/** The service: an OpenAPI document as an HTTP API. */
export const ParsedService: ParsedServiceSchema = Schema.Struct(parsedServiceFields);

export interface ParsedService extends Schema.Schema.Type<ParsedServiceSchema> {}
