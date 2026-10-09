import type { ParsedPathItem } from "@shipworthy/openapi-transformer";
import { Effect, Record } from "effect";
import ts from "#compiler";
import type { TypegenContext } from "../context.ts";
import type { TypegenError } from "../errors.ts";
import { refType, tsPropertyIndex } from "../lib/ts.ts";
import { createRef } from "../lib/utils.ts";
import { transformPathItem } from "./path-item.ts";

/**
 * Transform the `webhooks` map into a type keyed by webhook name.
 * @see https://spec.openapis.org/oas/v3.1.0#fixed-fields
 */
export const transformWebhooks = Effect.fnUntraced(function* (
  webhooks: Readonly<Record<string, ParsedPathItem>>,
): Effect.fn.Return<ts.TypeNode, TypegenError, TypegenContext> {
  const type = yield* Effect.forEach(
    Record.toEntries(webhooks),
    Effect.fnUntraced(function* ([name, item]) {
      return ts.factory.createPropertySignature(
        /* modifiers     */ undefined,
        /* name          */ tsPropertyIndex(name),
        /* questionToken */ undefined,
        /* type          */ item.reference
          ? yield* refType(item.reference.$ref)
          : yield* transformPathItem(item, createRef(["webhooks", name])),
      );
    }),
  );

  return ts.factory.createTypeLiteralNode(type);
});
