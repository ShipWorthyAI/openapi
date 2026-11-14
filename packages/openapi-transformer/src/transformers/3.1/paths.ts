import { OpenApiPathItem } from "@shipworthy/openapi-parser/schemas/3.1";
import { Array, Effect, Predicate, Record, String } from "effect";
import type { TransformContext } from "./context.ts";
import { transformOperation } from "./operation.ts";
import { child, resolve } from "./pointer.ts";
import { readExtensions } from "./extensions.ts";
import { httpMethods, type ParsedPathItem } from "../../model/index.ts";
import { transformParameterList } from "./parameters.ts";
import { transformServerList } from "./servers.ts";

export const transformPathItem = Effect.fnUntraced(function* (
  ctx: TransformContext,
  key: string,
  value: OpenApiPathItem,
  at: string,
  includeCallbacks: boolean,
) {
  const expand =
    value.$ref !== undefined &&
    (String.startsWith("#/paths/")(value.$ref) ||
      Array.some(Record.keys(value), (key) => key !== "$ref"));

  const {
    value: item,
    id,
    reference,
  } = yield* resolve(ctx.document, OpenApiPathItem, value, at, expand);

  const servers = yield* transformServerList(item.servers, child(id, "servers"));

  const parameters = yield* transformParameterList(
    ctx.document,
    item.parameters,
    child(id, "parameters"),
  );

  const operations = yield* Effect.forEach(httpMethods, (method) =>
    transformOperation(ctx, key, method, item, id, servers, parameters, includeCallbacks),
  );

  return {
    id,
    reference,
    summary: item.summary,
    description: item.description,
    parameters,
    operations: Array.filter(operations, Predicate.isNotUndefined),
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
  const entries = Array.filter(
    Record.toEntries(value ?? {}),
    ([key]) => !skipExtensions || !String.startsWith("x-")(key),
  );

  return Record.fromEntries(
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
