import { Schema } from "effect";
import { ParsedExternalDocs } from "./external-docs.ts";
import { node } from "./fields.ts";
import { HttpMethodName } from "./http-method.ts";
import { optionalField, optionalString } from "./optional.ts";
import { ParsedRequest } from "./request.ts";
import { ParsedOperationResponse } from "./response.ts";
import { ParsedSecurityRequirement, SecurityDeclaration } from "./security.ts";
import { ParsedServer } from "./server.ts";
import { ParsedTag } from "./tag.ts";

const operationFields = {
  ...node,
  operationId: optionalString,
  method: HttpMethodName,
  /** The key of the path item that declares this operation: a URL template, a webhook or component name, or a callback expression. */
  path: Schema.String,
  summary: optionalString,
  description: optionalString,
  deprecated: Schema.Boolean,
  tags: Schema.Array(ParsedTag),
  externalDocs: optionalField(ParsedExternalDocs),
  /** Path-level parameters merged with the operation's own. Operation parameters win. */
  request: ParsedRequest,
  /** In key order, including `default`. Integer-like codes come first, as in any JS object. */
  responses: Schema.Array(ParsedOperationResponse),
  /** Operation servers, else path item servers, else the service's servers. */
  servers: Schema.Array(ParsedServer),
  security: Schema.Array(ParsedSecurityRequirement),
  securityDeclaration: SecurityDeclaration,
};

const parsedCallbackOperationFields = { ...operationFields, key: Schema.String };

export interface ParsedCallbackOperationSchema extends Schema.Struct<
  typeof parsedCallbackOperationFields
> {}

/**
 * An operation of a callback. `key` is the callback's name and `path` its expression.
 */
export const ParsedCallbackOperation: ParsedCallbackOperationSchema = Schema.Struct(
  parsedCallbackOperationFields,
);

export interface ParsedCallbackOperation extends Schema.Schema.Type<ParsedCallbackOperationSchema> {}

const parsedOperationFields = {
  ...operationFields,
  callbacks: Schema.Array(ParsedCallbackOperation),
};

export interface ParsedOperationSchema extends Schema.Struct<typeof parsedOperationFields> {}

export const ParsedOperation: ParsedOperationSchema = Schema.Struct(parsedOperationFields);

export interface ParsedOperation extends Schema.Schema.Type<ParsedOperationSchema> {}
