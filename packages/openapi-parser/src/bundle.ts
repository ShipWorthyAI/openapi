import { Effect, Schema } from "effect";
import { OpenApiSource, ParsedOpenApiFromDocument } from "./codec.js";
import type { LoadedDocument } from "./load.js";

const decodeBundled = Schema.decodeUnknownEffect(ParsedOpenApiFromDocument);

/**
 * Bundle a loaded document into one OpenAPI object with only local `$ref`s. OpenAPI 3.0 is
 * upgraded to 3.1 on the way.
 */
export const bundleDocument = Effect.fn("bundleDocument")(function* (loaded: LoadedDocument) {
  return yield* decodeBundled(loaded.document).pipe(
    Effect.provideService(OpenApiSource, loaded.absoluteRef),
  );
});
