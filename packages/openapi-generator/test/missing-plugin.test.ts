import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Result } from "effect";
import { FetchHttpClient } from "effect/http";
import { generate, ModuleLoader } from "../src/index.js";

const layer = Layer.mergeAll(FileSystem.layerNoop({}), Path.layer, FetchHttpClient.layer);

const source = { openapi: "3.1.0", info: { title: "Pets", version: "1.0.0" }, paths: {} };

const generator = {
  specifier: "example-generator",
  exportName: "generate",
  source,
};

describe("plugins", () => {
  it.effect("tells the caller to install the missing module", () =>
    Effect.gen(function* () {
      const cause = new Error("Cannot find package");

      const result = yield* Effect.result(
        generate(generator).pipe(
          Effect.provideService(ModuleLoader, { load: () => Promise.reject(cause) }),
        ),
      );

      if (Result.isSuccess(result)) return yield* Effect.die("expected plugin load to fail");

      const error = result.failure;
      assert.strictEqual(error._tag, "MissingPlugin");
      if (error._tag !== "MissingPlugin") return;

      assert.strictEqual(error.message, "Install example-generator to load generate.");

      assert.strictEqual(error.cause, cause);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("reports a module that does not export a generator", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        generate(generator).pipe(
          Effect.provideService(ModuleLoader, { load: () => Promise.resolve({}) }),
        ),
      );

      if (Result.isSuccess(result)) return yield* Effect.die("expected plugin load to fail");

      const error = result.failure;
      assert.strictEqual(error._tag, "InvalidPlugin");
      if (error._tag !== "InvalidPlugin") return;

      assert.strictEqual(error.message, "Module example-generator does not export generate.");
    }).pipe(Effect.provide(layer)),
  );
});
