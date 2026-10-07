import { Schema } from "effect";
import { ParsedExternalDocs } from "./external-docs.js";
import { node } from "./fields.js";
import { HttpMethodName } from "./http-method.js";
import { optionalField, optionalString } from "./optional.js";
import { ParsedRequest } from "./request.js";
import { ParsedOperationResponse } from "./response.js";
import { ParsedSecurityRequirement, SecurityDeclaration } from "./security.js";
import { ParsedServer } from "./server.js";
import { ParsedTag } from "./tag.js";

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

/**
 * An operation of a callback. `key` is the callback's name and `path` its expression. As in
 * Stoplight's model, callback operations have no callbacks of their own.
 */
export const ParsedCallbackOperation = Schema.Struct({ ...operationFields, key: Schema.String });

export type ParsedCallbackOperation = typeof ParsedCallbackOperation.Type;

export const ParsedOperation = Schema.Struct({
  ...operationFields,
  callbacks: Schema.Array(ParsedCallbackOperation),
});

export type ParsedOperation = typeof ParsedOperation.Type;
