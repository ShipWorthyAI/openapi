import type { ParsedPathItem } from "@shipworthy/openapi-transformer";
import { Effect } from "effect";
import ts from "#compiler";
import { TypegenContext } from "../context.ts";
import type { TypegenError } from "../errors.ts";
import { refType, tsModifiers, tsPropertyIndex } from "../lib/ts.ts";
import { createRef, getEntries } from "../lib/utils.ts";
import { transformPathItem } from "./path-item.ts";

/**
 * Transform the `webhooks` map into a type keyed by webhook name.
 * @see https://spec.openapis.org/oas/v3.1.0#fixed-fields
 */
export const transformWebhooks = Effect.fnUntraced(function* (
  webhooks: Readonly<Record<string, ParsedPathItem>>,
): Effect.fn.Return<ts.TypeNode, TypegenError, TypegenContext> {
  const ctx = yield* TypegenContext;
  const type: ts.TypeElement[] = [];

  for (const [name, item] of getEntries(webhooks, ctx)) {
    type.push(
      ts.factory.createPropertySignature(
        /* modifiers     */ tsModifiers({ readonly: ctx.immutable }),
        /* name          */ tsPropertyIndex(name),
        /* questionToken */ undefined,
        /* type          */ item.reference
          ? yield* refType(item.reference.$ref)
          : yield* transformPathItem(item, createRef(["webhooks", name])),
      ),
    );
  }

  return ts.factory.createTypeLiteralNode(type);
});
