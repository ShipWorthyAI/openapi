import type { OpenAPIDocument } from "@shipworthy/openapi-parser";
import { Effect } from "effect";
import { InvalidSchema } from "./errors.js";
import type { ParsedService } from "./model/index.js";
import { parseOpenApi3_1 } from "./transformers/3.1/index.js";

/**
 * Decode an OpenAPI object into the HTTP meta model. The object comes from `bundleDocument` in
 * `@shipworthy/openapi-parser`, which upgrades OpenAPI 3.0 to 3.1 and leaves only local `$ref`s.
 * Fails with `InvalidSchema` when a schema position holds something other than an object or a
 * boolean.
 */
export const decode = Effect.fn("decode")(function* (
  document: OpenAPIDocument,
): Effect.fn.Return<ParsedService, InvalidSchema> {
  return yield* Effect.sync(() => parseOpenApi3_1(document)).pipe(
    // the transformers throw InvalidSchema for the document; anything else is a bug
    Effect.catchDefect((cause) =>
      cause instanceof InvalidSchema ? Effect.fail(cause) : Effect.die(cause),
    ),
  );
});
