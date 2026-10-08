import { NodeFileSystem, NodeHttpClient } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { runEffect } from "../src/run.js";

const layer = Layer.mergeAll(NodeFileSystem.layer, NodeHttpClient.layerUndici);

function run(mode: Parameters<typeof runEffect>[0], args: unknown[]) {
  return Effect.runPromise(
    runEffect(mode, args).pipe(
      Effect.map((result) => result.schema),
      Effect.provide(layer),
    ),
  );
}

export const parse = (...args: unknown[]) => run("parse", args);
export const bundle = (...args: unknown[]) => run("bundle", args);
export const dereference = (...args: unknown[]) => run("dereference", args);
