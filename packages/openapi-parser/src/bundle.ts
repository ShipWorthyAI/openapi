import { Effect, Schema, SchemaIssue } from "effect";
import { ParsedOpenApiFromDocument } from "./codec.js";
import { loadDocument, type LoadOptions } from "./load.js";

export type BundleOptions = LoadOptions;

/**
 * Load a file URL, HTTP URL, JSON/YAML string, stream, Buffer, or object, then bundle,
 * upgrade, and validate it as OpenAPI 3.1. Object input is never serialized.
 */
export const bundleDocument = Effect.fn("bundleDocument")(function* (
  source: unknown,
  options?: BundleOptions,
) {
  const loaded = yield* loadDocument(source, options).pipe(
    Effect.mapError(
      (error) => new Schema.SchemaError(new SchemaIssue.InvalidValue({ message: error.message })),
    ),
  );

  return yield* Schema.decodeEffect(ParsedOpenApiFromDocument({ sourceUrl: loaded.absoluteRef }))(
    loaded.document,
  );
});
