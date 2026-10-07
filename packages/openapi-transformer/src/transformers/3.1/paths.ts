import { Predicate, Schema } from "effect";
import type { ParseContext } from "./context.js";
import { parseOperation } from "./operation.js";
import { child, expandPathRef, resolve } from "./pointer.js";
import { readEntries, readExtensions, readString } from "./read.js";
import { httpMethods, ParsedPathItem } from "../../model/index.js";
import { parseParameterList } from "./parameters.js";
import { parseServerList } from "./servers.js";

/** A path item. `key` is the URL template, webhook name, callback expression, or component name it is declared under. */
export function parsePathItem(ctx: ParseContext, key: string, value: unknown, at: string) {
  const {
    value: item,
    id,
    reference,
  } = resolve(ctx.document, expandPathRef(ctx.document, value), at);

  if (!Predicate.isObject(item)) {
    return Schema.decodeSync(ParsedPathItem)({
      id,
      reference,
      parameters: [],
      operations: [],
      servers: [],
      extensions: {},
    });
  }

  const servers = parseServerList(item.servers, child(id, "servers"));

  return Schema.decodeSync(ParsedPathItem)({
    id,
    reference,
    summary: readString(item.summary),
    description: readString(item.description),
    parameters: parseParameterList(ctx.document, item.parameters, child(id, "parameters")),
    operations: httpMethods.flatMap((method) => {
      if (item[method] === undefined) return [];
      const operation = parseOperation(ctx, key, method, item, id, servers);
      return operation ? [operation] : [];
    }),
    servers: servers ?? [],
    extensions: readExtensions(item),
  });
}

/** A map of path items. `paths` and callbacks set `skipExtensions`, since their `x-` keys are extensions. */
export function parsePathItemMap(
  ctx: ParseContext,
  value: unknown,
  at: string,
  skipExtensions: boolean,
) {
  return Object.fromEntries(
    readEntries(value).flatMap(([key, entry]) => {
      if ((skipExtensions && key.startsWith("x-")) || !Predicate.isObject(entry)) return [];
      return [[key, parsePathItem(ctx, key, entry, child(at, key))] as const];
    }),
  );
}
