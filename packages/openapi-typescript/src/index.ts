import { performance } from "node:perf_hooks";
import type { ParsedService } from "@shipworthy/openapi-transformer";
import type { Generator } from "@shipworthy/openapi-generator";
import { Effect, Predicate, Schema } from "effect";
import ts from "#compiler";
import { makeTypegenContext, TypegenContext } from "./context.ts";
import { TypegenError } from "./errors.ts";
import { debug } from "./lib/utils.ts";
import { transformDocument } from "./transforms/document.ts";

export { TypegenError } from "./errors.ts";
export { formatTypeScript } from "./format.ts";
export { astToString } from "./lib/ts.ts";
export { resolveRef } from "./lib/utils.ts";
export type { OpenAPITSOptions, TransformNodeOptions, TransformObject } from "./types.ts";

/** TypeScript plugin. `generate` prints `paths`, `webhooks`, `components`, `$defs`, and `operations`. */
export const typescript: Generator<ts.Node[], TypegenError> = {
  id: "typescript",
  generate: Effect.fnUntraced(function* (
    input: ParsedService,
    raw: Readonly<Record<string, unknown>>,
  ): Effect.fn.Return<ts.Node[], TypegenError> {
    // Discriminator enum patching edits this working copy, never the caller's model.
    const model = structuredClone(input);
    const ctx = yield* makeTypegenContext(model, raw);
    const transformT = performance.now();

    const result = yield* transformDocument(model).pipe(
      Effect.provideService(TypegenContext, ctx),
      // user hooks run inside the transforms; their exceptions become TypegenError
      Effect.catchDefect((cause) =>
        Effect.fail(
          Schema.is(TypegenError)(cause)
            ? cause
            : new TypegenError({
                message: Predicate.isError(cause) ? cause.message : String(cause),
              }),
        ),
      ),
    );

    yield* debug(
      "Completed AST transformation for entire document",
      "ts",
      performance.now() - transformT,
    );

    return result;
  }),
};
