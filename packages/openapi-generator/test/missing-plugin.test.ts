import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Result } from "effect";
import { FetchHttpClient } from "effect/http";
import { generate, ModuleLoader } from "../src/index.ts";

const layer = Layer.mergeAll(FileSystem.layerNoop({}), Path.layer, FetchHttpClient.layer);

const source = { openapi: "3.1.0", info: { title: "Pets", version: "1.0.0" }, paths: {} };

const generator = {
  specifier: "example-generator",
  exportName: "generate",
  source,
};

describe("plugins", () => {
  it.effect("rejects invalid generator fields", () =>
    Effect.forEach(
      [
        { id: 42, generate: () => "ok" },
        { id: "fixture", generate: "invalid" },
      ],
      Effect.fnUntraced(function* (plugin) {
        const result = yield* Effect.result(
          generate(generator).pipe(
            Effect.provideService(ModuleLoader, {
              load: () => Promise.resolve({ generate: plugin }),
            }),
          ),
        );

        if (Result.isSuccess(result))
          return yield* Effect.die("expected invalid generator to fail");
        assert.strictEqual(result.failure._tag, "InvalidPlugin");
      }),
      { discard: true },
    ).pipe(Effect.provide(layer)),
  );

  it.effect("preserves generator identity and prototype methods during validation", () =>
    Effect.gen(function* () {
      class Plugin {
        readonly id = "fixture";
        label() {
          return "generated";
        }
        generate() {
          return this.label();
        }
      }
      const plugin = new Plugin();

      const output = yield* generate(generator).pipe(
        Effect.provideService(ModuleLoader, { load: () => Promise.resolve({ generate: plugin }) }),
      );

      assert.strictEqual(output, "generated");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("tells the caller to install the missing module", () =>
    Effect.gen(function* () {
      const cause = Object.assign(
        new Error("Cannot find package 'example-generator' imported from /app/cli.js"),
        { code: "ERR_MODULE_NOT_FOUND" },
      );

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

  it.effect("reports why an installed module failed to load", () =>
    Effect.gen(function* () {
      const cause = Object.assign(
        new Error("Cannot find module '/app/node_modules/typescript/unstable/ast'"),
        { code: "ERR_MODULE_NOT_FOUND" },
      );

      const result = yield* Effect.result(
        generate(generator).pipe(
          Effect.provideService(ModuleLoader, { load: () => Promise.reject(cause) }),
        ),
      );

      if (Result.isSuccess(result)) return yield* Effect.die("expected plugin load to fail");

      const error = result.failure;
      assert.strictEqual(error._tag, "MissingPlugin");
      if (error._tag !== "MissingPlugin") return;

      assert.strictEqual(
        error.message,
        "Could not load example-generator: Cannot find module '/app/node_modules/typescript/unstable/ast'",
      );

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
