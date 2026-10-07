import { Effect, type FileSystem, Schema } from "effect";
import type { HttpClient } from "effect/http";
import { OpenAPIDocument } from "./document.js";
import { BundleFailure, type TaggedFailure } from "./errors.js";
import type { LoadedDocument } from "./load.js";
import { runEffect } from "./run.js";

const decodeBundled = Schema.decodeUnknownEffect(OpenAPIDocument);

/**
 * Bundle a loaded document into one OpenAPI object with only local `$ref`s. OpenAPI 3.0 is
 * upgraded to 3.1 on the way.
 */
export const bundleDocument = Effect.fn("bundleDocument")(function* (
  loaded: LoadedDocument,
): Effect.fn.Return<OpenAPIDocument, TaggedFailure, FileSystem.FileSystem | HttpClient.HttpClient> {
  const result = yield* runEffect("bundle", [loaded.absoluteRef, loaded.document]);

  return yield* decodeBundled(result.schema).pipe(
    Effect.mapError(
      () => new BundleFailure({ message: "Bundling did not produce an OpenAPI document" }),
    ),
  );
});
