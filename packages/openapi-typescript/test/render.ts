import { NodeServices } from "@effect/platform-node";
import { generate } from "@shipworthy/openapi-generator";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import type { Node } from "#compiler";
import { astToString, COMMENT_HEADER, formatTypeScript } from "../src/index.js";
import type { OpenAPITSOptions } from "../src/types.js";

const layer = Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer);

const renderEffect = Effect.fn("render")(function* (
  source: unknown,
  options: OpenAPITSOptions = {},
) {
  const nodes = yield* generate({
    specifier: "@shipworthy/openapi-typescript",
    exportName: "typescript",
    source,
    cwd: options.cwd instanceof URL || typeof options.cwd === "string" ? options.cwd : undefined,
    pluginOptions: options,
  });

  const printed = astToString(nodes as readonly Node[]);

  return yield* Effect.tryPromise({
    try: () => formatTypeScript(`${COMMENT_HEADER}${printed}`),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
});

/** Print a schema the way `openapi generate typescript` writes a file. */
export function render(source: unknown, options: OpenAPITSOptions = {}) {
  return renderEffect(source, options).pipe(Effect.provide(layer));
}
