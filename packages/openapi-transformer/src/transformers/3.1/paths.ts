import { OpenApiPathItem } from "@shipworthy/openapi-parser/schemas/3.1";
import { Effect } from "effect";
import type { TransformContext } from "./context.js";
import { transformOperation } from "./operation.js";
import { child, resolve } from "./pointer.js";
import { readExtensions } from "./extensions.js";
import { httpMethods, type ParsedPathItem } from "../../model/index.js";
import { transformParameterList } from "./parameters.js";
import { transformServerList } from "./servers.js";

export const transformPathItem = Effect.fnUntraced(function* (
  ctx: TransformContext,
  key: string,
  value: OpenApiPathItem,
  at: string,
  includeCallbacks: boolean,
) {
  const expand =
    value.$ref !== undefined &&
    (value.$ref.startsWith("#/paths/") || Object.keys(value).some((key) => key !== "$ref"));

  const {
    value: item,
    id,
    reference,
  } = yield* resolve(ctx.document, OpenApiPathItem, value, at, expand);

  const servers = yield* transformServerList(item.servers, child(id, "servers"));

  const operations = yield* Effect.forEach(httpMethods, (method) =>
    transformOperation(ctx, key, method, item, id, servers, includeCallbacks),
  );

  return {
    id,
    reference,
    summary: item.summary,
    description: item.description,
    parameters: yield* transformParameterList(
      ctx.document,
      item.parameters,
      child(id, "parameters"),
    ),
    operations: operations.filter((operation) => operation !== undefined),
    servers: servers ?? [],
    extensions: readExtensions(item),
  } satisfies typeof ParsedPathItem.Encoded;
});

export const transformPathItemMap = Effect.fnUntraced(function* (
  ctx: TransformContext,
  value: Readonly<Record<string, OpenApiPathItem>> | undefined,
  at: string,
  skipExtensions: boolean,
  includeCallbacks = true,
) {
  const entries = Object.entries(value ?? {}).filter(
    ([key]) => !skipExtensions || !key.startsWith("x-"),
  );

  return Object.fromEntries(
    yield* Effect.forEach(
      entries,
      Effect.fnUntraced(function* ([key, entry]) {
        return [
          key,
          yield* transformPathItem(ctx, key, entry, child(at, key), includeCallbacks),
        ] as const;
      }),
    ),
  );
});
