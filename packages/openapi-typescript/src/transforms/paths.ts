import type { ParsedPathItem } from "@shipworthy/openapi-transformer";
import { Effect, Record } from "effect";
import { performance } from "node:perf_hooks";
import ts from "#compiler";
import type { TypegenContext } from "../context.ts";
import type { TypegenError } from "../errors.ts";
import { refType, tsPropertyIndex } from "../lib/ts.ts";
import { createRef, debug } from "../lib/utils.ts";
import { transformPathItem } from "./path-item.ts";

/**
 * Transform the Paths Object (4.8.8) into a type keyed by URL template.
 * @see https://spec.openapis.org/oas/v3.1.0#paths-object
 */
export const transformPaths = Effect.fnUntraced(function* (
  paths: Readonly<Record<string, ParsedPathItem>>,
): Effect.fn.Return<ts.TypeNode, TypegenError, TypegenContext> {
  const type = yield* Effect.forEach(
    Record.toEntries(paths),
    Effect.fnUntraced(function* ([url, item]) {
      const pathT = performance.now();

      if (item.reference) {
        return ts.factory.createPropertySignature(
          /* modifiers     */ undefined,
          /* name          */ tsPropertyIndex(url),
          /* questionToken */ undefined,
          /* type          */ yield* refType(item.reference.$ref),
        );
      }

      const pathItemType = yield* transformPathItem(item, createRef(["paths", url]));

      const property = ts.factory.createPropertySignature(
        /* modifiers     */ undefined,
        /* name          */ tsPropertyIndex(url),
        /* questionToken */ undefined,
        /* type          */ pathItemType,
      );

      yield* debug(`Transformed path "${url}"`, "ts", performance.now() - pathT);
      return property;
    }),
  );

  return ts.factory.createTypeLiteralNode(type);
});
