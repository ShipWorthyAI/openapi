import type { OpenApiPathItem } from "@shipworthy/openapi-parser";
import { Effect } from "effect";
import type { TransformContext } from "./context.js";
import { transformCallbackList } from "./callbacks.js";
import { transformParameters } from "./parameters.js";
import { transformRequestBody } from "./request.js";
import { transformOperationResponses } from "./responses.js";
import { transformSecurityRequirements } from "./securities.js";
import { transformExternalDocs, transformServerList } from "./servers.js";
import { child } from "./pointer.js";
import { readExtensions } from "./extensions.js";
import type {
  HttpMethodName,
  ParsedOperation,
  ParsedServer,
  ParsedTag,
  SecurityDeclaration,
} from "../../model/index.js";

const methods = {
  get: "GET",
  put: "PUT",
  post: "POST",
  delete: "DELETE",
  options: "OPTIONS",
  head: "HEAD",
  patch: "PATCH",
  trace: "TRACE",
} as const satisfies Record<Lowercase<HttpMethodName>, HttpMethodName>;

function transformOperationTags(
  ctx: TransformContext,
  value: readonly string[] | undefined,
  at: string,
) {
  return (value ?? []).map(
    (name, index) =>
      ctx.tags.find((tag) => tag.name === name) ??
      ({ id: child(at, index), name, extensions: {} } satisfies typeof ParsedTag.Encoded),
  );
}

export const transformOperation = Effect.fnUntraced(function* (
  ctx: TransformContext,
  path: string,
  method: Lowercase<HttpMethodName>,
  pathItem: OpenApiPathItem,
  pathItemId: string,
  pathServers: readonly (typeof ParsedServer.Encoded)[] | undefined,
  includeCallbacks: boolean,
) {
  const operation = pathItem[method];
  if (operation === undefined) return undefined;
  const id = child(pathItemId, method);
  const { document } = ctx;
  const declared = operation.security !== undefined;

  const security = declared
    ? yield* transformSecurityRequirements(operation.security, ctx.securitySchemes)
    : ctx.security;

  const securityDeclaration: SecurityDeclaration = declared
    ? security.length > 0
      ? "declared"
      : "none"
    : ctx.security.length > 0
      ? "inheritedFromService"
      : "none";

  return {
    id,
    operationId: operation.operationId,
    method: methods[method],
    path,
    summary: operation.summary,
    description: operation.description,
    deprecated: operation.deprecated === true,
    tags: transformOperationTags(ctx, operation.tags, child(id, "tags")),
    externalDocs: yield* transformExternalDocs(operation.externalDocs),
    request: {
      ...(yield* transformParameters(document, [
        [pathItem.parameters, child(pathItemId, "parameters")],
        [operation.parameters, child(id, "parameters")],
      ])),
      body: yield* transformRequestBody(document, operation.requestBody, child(id, "requestBody")),
    },
    responses: yield* transformOperationResponses(
      document,
      operation.responses,
      child(id, "responses"),
    ),
    servers:
      (yield* transformServerList(operation.servers, child(id, "servers"))) ??
      pathServers ??
      ctx.servers,
    callbacks: includeCallbacks
      ? yield* transformCallbackList(ctx, operation.callbacks, child(id, "callbacks"))
      : [],
    security,
    securityDeclaration,
    extensions: readExtensions(operation),
  } satisfies typeof ParsedOperation.Encoded;
});
