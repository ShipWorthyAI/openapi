import type { OpenApiPathItem } from "@shipworthy/openapi-parser/schemas/3.1";
import { Array, Effect, Option } from "effect";
import type { TransformContext } from "./context.ts";
import { transformCallbackList } from "./callbacks.ts";
import { transformParameterList } from "./parameters.ts";
import { transformRequestBody } from "./request.ts";
import { transformOperationResponses } from "./responses.ts";
import { transformSecurityRequirements } from "./securities.ts";
import { transformExternalDocs, transformServerList } from "./servers.ts";
import { child } from "./pointer.ts";
import { readExtensions } from "./extensions.ts";
import type {
  HttpMethodName,
  ParameterLocation,
  ParsedParameter,
  ParsedParameters,
  ParsedOperation,
  ParsedServer,
  ParsedTag,
  SecurityDeclaration,
} from "../../model/index.ts";

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
  pathParameters: readonly (typeof ParsedParameter.Encoded)[],
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

  const parameters = yield* transformParameterList(
    document,
    operation.parameters,
    child(id, "parameters"),
  );

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
      ...mergeParameters(pathParameters, parameters),
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

const groups = { path: "path", query: "query", header: "headers", cookie: "cookie" } as const;

/** Operation parameters replace matching path parameters without reordering their group. */
function mergeParameters(...sources: readonly (readonly (typeof ParsedParameter.Encoded)[])[]) {
  const grouped: Record<(typeof groups)[ParameterLocation], (typeof ParsedParameter.Encoded)[]> = {
    path: [],
    query: [],
    headers: [],
    cookie: [],
  };

  const merged = Array.reduce(Array.flatten(sources), grouped, (result, parsed) => {
    const group = groups[parsed.in];
    const list = result[group];
    const index = Array.findFirstIndex(list, (item) => item.name === parsed.name);

    result[group] = Option.match(index, {
      onNone: () => Array.append(list, parsed),
      onSome: (index) => Array.map(list, (item, position) => (position === index ? parsed : item)),
    });

    return result;
  });

  return { ...merged, unknown: [] } satisfies typeof ParsedParameters.Encoded;
}
