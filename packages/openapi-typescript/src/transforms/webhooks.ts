import type { ParsedPathItem } from "@shipworthy/openapi-transformer";
import { Effect } from "effect";
import ts from "#compiler";
import { TypegenContext } from "../context.js";
import type { TypegenError } from "../errors.js";
import { refType, tsModifiers, tsPropertyIndex } from "../lib/ts.js";
import { createRef, getEntries } from "../lib/utils.js";
import { transformPathItem } from "./path-item.js";

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
