import { Predicate, Schema } from "effect";
import type { ParseContext } from "./context.js";
import { parseCallbackList } from "./callbacks.js";
import { parseParameters } from "./parameters.js";
import { parseRequestBody } from "./request.js";
import { parseOperationResponses } from "./responses.js";
import { parseSecurityRequirements } from "./securities.js";
import { parseExternalDocs, parseServerList } from "./servers.js";
import { child, resolve } from "./pointer.js";
import { readExtensions, readString } from "./read.js";
import {
  HttpMethodName,
  ParsedOperation,
  type ParsedServer,
  ParsedTag,
  type SecurityDeclaration,
} from "../../model/index.js";

const decodeMethod = Schema.decodeUnknownSync(HttpMethodName);

/** An operation's tags: the document's declaration when there is one, else just the name. */
function parseOperationTags(ctx: ParseContext, value: unknown, at: string) {
  if (!Array.isArray(value)) return [];

  return value.flatMap((name, index) => {
    if (typeof name !== "string") return [];
    const declared = ctx.tags.find((tag) => tag.name === name);

    return [
      declared ?? Schema.decodeSync(ParsedTag)({ id: child(at, index), name, extensions: {} }),
    ];
  });
}

/** One operation of a resolved path item. */
export function parseOperation(
  ctx: ParseContext,
  path: string,
  method: Lowercase<HttpMethodName>,
  pathItem: Record<string, unknown>,
  pathItemId: string,
  pathServers: readonly ParsedServer[] | undefined,
) {
  const { document } = ctx;
  const { value: operation, id } = resolve(document, pathItem[method], child(pathItemId, method));
  if (!Predicate.isObject(operation)) return undefined;
  const body = parseRequestBody(document, operation.requestBody, child(id, "requestBody"));
  const declared = Object.hasOwn(operation, "security");

  const security = declared
    ? parseSecurityRequirements(operation.security, ctx.securitySchemes)
    : ctx.security;

  const securityDeclaration: SecurityDeclaration = declared
    ? security.length > 0
      ? "declared"
      : "none"
    : ctx.security.length > 0
      ? "inheritedFromService"
      : "none";

  return Schema.decodeSync(ParsedOperation)({
    id,
    operationId: readString(operation.operationId),
    method: decodeMethod(method.toUpperCase()),
    path,
    summary: readString(operation.summary),
    description: readString(operation.description),
    deprecated: operation.deprecated === true,
    tags: parseOperationTags(ctx, operation.tags, child(id, "tags")),
    externalDocs: parseExternalDocs(operation.externalDocs),
    request: {
      ...parseParameters(document, [
        [pathItem.parameters, child(pathItemId, "parameters")],
        [operation.parameters, child(id, "parameters")],
      ]),
      body,
    },
    responses: parseOperationResponses(document, operation.responses, child(id, "responses")),
    servers: parseServerList(operation.servers, child(id, "servers")) ?? pathServers ?? ctx.servers,
    callbacks: parseCallbackList(ctx, operation.callbacks, child(id, "callbacks")),
    security,
    securityDeclaration,
    extensions: readExtensions(operation),
  });
}
