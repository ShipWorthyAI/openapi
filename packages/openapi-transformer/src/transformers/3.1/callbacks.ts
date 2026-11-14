import {
  OpenApiCallback,
  type OpenApiComponents,
  type OpenApiOperation,
  type OpenApiReference,
} from "@shipworthy/openapi-parser/schemas/3.1";
import { Array, Effect, Record, type SchemaIssue } from "effect";
import type { TransformContext } from "./context.ts";
import { child, resolve } from "./pointer.ts";
import type { ParsedCallbackOperation } from "../../model/index.ts";
import { transformPathItemMap } from "./paths.ts";

/** The meta model flattens callbacks into operations without nested callback collections. */
const transformCallback = Effect.fnUntraced(function* (
  ctx: TransformContext,
  key: string,
  value: OpenApiCallback | OpenApiReference,
  at: string,
): Effect.fn.Return<readonly (typeof ParsedCallbackOperation.Encoded)[], SchemaIssue.Issue> {
  const { value: callback, id } = yield* resolve(ctx.document, OpenApiCallback, value, at);
  const paths = yield* transformPathItemMap(ctx, callback, id, true, false);

  return Array.flatMap(Record.values(paths), (item) =>
    Array.map(
      item.operations,
      ({ callbacks: _callbacks, ...operation }) =>
        ({ ...operation, key }) satisfies typeof ParsedCallbackOperation.Encoded,
    ),
  );
});

export const transformCallbackList = Effect.fnUntraced(function* (
  ctx: TransformContext,
  value: OpenApiOperation["callbacks"],
  at: string,
) {
  const callbacks = yield* Effect.forEach(Record.toEntries(value ?? {}), ([key, entry]) =>
    transformCallback(ctx, key, entry, child(at, key)),
  );

  return callbacks.flat();
});

export const transformCallbackMap = Effect.fnUntraced(function* (
  ctx: TransformContext,
  value: OpenApiComponents["callbacks"],
  at: string,
) {
  return Record.fromEntries(
    yield* Effect.forEach(
      Record.toEntries(value ?? {}),
      Effect.fnUntraced(function* ([key, entry]) {
        return [key, yield* transformCallback(ctx, key, entry, child(at, key))] as const;
      }),
    ),
  );
});
