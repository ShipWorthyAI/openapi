import { NodeServices } from "@effect/platform-node";
import { generate } from "@shipworthy/openapi-transformer";
import { Effect } from "effect";
import type ts from "typescript";
import type { OpenAPITSOptions } from "../src/types.js";

/** Run the typescript plugin through the transformer, the way callers load a schema. */
export function openapiTS(source: unknown, options: OpenAPITSOptions = {}) {
  return Effect.runPromise(
    generate({
      plugin: "typescript",
      source,
      cwd: options.cwd instanceof URL || typeof options.cwd === "string" ? options.cwd : undefined,
      silent: options.silent,
      lint: true,
      pluginOptions: options,
    }).pipe(Effect.provide(NodeServices.layer)),
  ) as Promise<ts.Node[]>;
}
