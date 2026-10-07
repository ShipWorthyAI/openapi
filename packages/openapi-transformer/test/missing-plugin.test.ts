import { Effect, FileSystem, Layer, Path } from "effect";
import { describe, expect, it } from "vitest";
import { generate } from "../src/index.js";

const layer = Layer.mergeAll(FileSystem.layerNoop({}), Path.layer);

describe("missing plugin", () => {
  it("tells the caller to install the typescript plugin", async () => {
    const program = generate({
      plugin: "typescript",
      source: { openapi: "3.1.0", info: { title: "Pets", version: "1.0.0" }, paths: {} },
      lint: false,
      loadModule: () => Promise.reject(new Error("Cannot find package")),
    }).pipe(Effect.provide(layer));
    await expect(Effect.runPromise(program)).rejects.toThrow(
      "Install @shipworthy/openapi-typescript to run openapi generate typescript.",
    );
  });
});
