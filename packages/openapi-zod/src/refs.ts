import type { ParsedService } from "@shipworthy/openapi-transformer";
import { resolveRef } from "@shipworthy/openapi-typescript";
import { Effect } from "effect";
import { ZodGenerationError } from "./errors.ts";

/** Follow an internal `$ref` on a parsed document. Boolean `false` is a real schema. */
export const resolveDocumentRef = Effect.fnUntraced(function* (
  model: ParsedService,
  ref: string,
): Effect.fn.Return<unknown, ZodGenerationError> {
  const resolved = yield* Effect.try({
    try: () => resolveRef<unknown>(model, ref, { silent: true }),
    catch: (cause) => new ZodGenerationError({ message: `${ref}: Unresolved reference`, cause }),
  });

  if (resolved === undefined) {
    return yield* new ZodGenerationError({ message: `${ref}: Unresolved reference` });
  }

  return resolved;
});
