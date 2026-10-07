import { NodeServices } from "@effect/platform-node";
import { generate } from "@shipworthy/openapi-generator";
import { decode, type ParsedService } from "@shipworthy/openapi-transformer";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import type ts from "#compiler";
import { makeTypegenContext, TypegenContext } from "../src/context.js";
import type { TypegenError } from "../src/errors.js";
import { astToString } from "../src/lib/ts.js";

const info = { title: "Test", version: "1.0.0" };

/** Decode an OpenAPI 3.1 document from just the fields a test needs. */
export function document(fields: Record<string, unknown>): ParsedService {
  return Effect.runSync(decode({ openapi: "3.1.0", info, ...fields }));
}

/** Run a transform on `model` with plugin options, and print what it returns. */
export function print(
  model: ParsedService,
  transform: Effect.Effect<ts.Node | readonly ts.Node[], TypegenError, TypegenContext>,
  options: Record<string, unknown> = {},
) {
  return transform.pipe(
    Effect.map((nodes) =>
      astToString(Array.isArray(nodes) ? [...nodes] : [nodes as ts.Node]).trim(),
    ),
    Effect.provideServiceEffect(TypegenContext, makeTypegenContext(model, options)),
  );
}

/** Generate types for a raw document the way the CLI does: load, bundle, parse, then transform. */
export function generateTypes(source: unknown, options: Record<string, unknown> = {}) {
  return generate({
    specifier: "@shipworthy/openapi-typescript",
    exportName: "typescript",
    source,
    pluginOptions: options,
  }).pipe(
    Effect.map((nodes) => astToString(nodes as ts.Node[]).trim()),
    Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
  );
}
