import { Schema } from "effect";
import type { ParseContext } from "./context.js";
import { child, resolve } from "./pointer.js";
import { readEntries } from "./read.js";
import { ParsedCallbackOperation } from "../../model/index.js";
import { parsePathItemMap } from "./paths.js";

/**
 * The operations of one callback. Each keeps the callback's name in `key` and its expression in
 * `path`. The result type is named because callbacks parse path items, which parse operations,
 * which parse callbacks.
 */
export function parseCallback(
  ctx: ParseContext,
  key: string,
  value: unknown,
  at: string,
): readonly ParsedCallbackOperation[] {
  const { value: callback, id } = resolve(ctx.document, value, at);

  return Object.values(parsePathItemMap(ctx, callback, id, true)).flatMap((item) =>
    item.operations.map((operation) =>
      Schema.decodeSync(ParsedCallbackOperation)({ ...operation, key }),
    ),
  );
}

/** The operations of every callback in a map, in document order. */
export function parseCallbackList(ctx: ParseContext, value: unknown, at: string) {
  return readEntries(value).flatMap(([key, entry]) =>
    parseCallback(ctx, key, entry, child(at, key)),
  );
}

export function parseCallbackMap(ctx: ParseContext, value: unknown, at: string) {
  return Object.fromEntries(
    readEntries(value).flatMap(([key, entry]) => {
      const operations = parseCallback(ctx, key, entry, child(at, key));
      return operations.length > 0 ? [[key, operations] as const] : [];
    }),
  );
}
