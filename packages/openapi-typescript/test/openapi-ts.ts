import { NodeServices } from "@effect/platform-node";
import { generate } from "@shipworthy/openapi-generator";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import type ts from "typescript";
import type { OpenAPITSOptions } from "../src/types.js";

const layer = Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer);

/** Run the typescript plugin through the generator, the way callers load a schema. */
export function openapiTS(source: unknown, options: OpenAPITSOptions = {}) {
  return generate({
    specifier: "@shipworthy/openapi-typescript",
    exportName: "typescript",
    source,
    cwd: options.cwd instanceof URL || typeof options.cwd === "string" ? options.cwd : undefined,
    pluginOptions: options,
  }).pipe(Effect.provide(layer)) as Effect.Effect<readonly ts.Node[]>;
}
