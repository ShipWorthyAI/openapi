import { describe, it } from "@effect/vitest";
import type { ParsedService } from "@shipworthy/openapi-transformer";
import { Effect, FileSystem, Layer, Path, Result } from "effect";
import { FetchHttpClient } from "effect/http";
import { strict as assert } from "node:assert";
import { generate, loadService, ModuleLoader, runPlugin, type Generator } from "../src/index.ts";

const layer = Layer.mergeAll(FileSystem.layerNoop({}), Path.layer, FetchHttpClient.layer);

const source = {
  openapi: "3.0.3",
  info: { title: "Pets", version: "1" },
  components: { schemas: { Name: { type: "string", nullable: true } } },
};

const echo: Generator<ParsedService> = { id: "echo", generate: (model) => model };

const loader = (module: Record<string, unknown>) =>
  Effect.provideService(ModuleLoader, { load: () => Promise.resolve(module) });

describe("loadService", () => {
  it.effect("returns the model a plugin receives through generate", () =>
    Effect.gen(function* () {
      const fromObject = yield* loadService(source);
      const fromJson = yield* loadService(JSON.stringify(source));

      const viaGenerate = yield* generate({
        specifier: "fixture",
        exportName: "echo",
        source,
      }).pipe(loader({ echo }));

      assert.equal(fromObject.openapi, "3.1.0");
      assert.deepEqual(fromObject.components.schemas.Name, { type: ["string", "null"] });
      assert.deepEqual(fromObject, viaGenerate);
      assert.deepEqual(fromJson, viaGenerate);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("fails with ResolveError for an invalid source", () =>
    Effect.gen(function* () {
      const invalid = yield* Effect.result(
        loadService({ openapi: "3.1.0", info: { title: "Pets" }, paths: {} }),
      );

      const unparsable = yield* Effect.result(loadService("{ not: [valid"));

      assert.ok(Result.isFailure(invalid));
      assert.equal(invalid.failure._tag, "ResolveError");
      assert.ok(Result.isFailure(unparsable));
      assert.equal(unparsable.failure._tag, "ResolveError");
    }).pipe(Effect.provide(layer)),
  );
});

describe("runPlugin", () => {
  it.effect("runs several plugins against one loaded model", () =>
    Effect.gen(function* () {
      const model = yield* loadService(source);
      const calls: Array<{ id: string; model: ParsedService; options: unknown }> = [];
      const first = { id: "first" };
      const second = { id: "second" };

      const plugins = {
        first: {
          id: "first",
          generate: (received: ParsedService, options: unknown) => {
            calls.push({ id: "first", model: received, options });
            return first;
          },
        },
        second: {
          id: "second",
          generate: (received: ParsedService, options: unknown) => {
            calls.push({ id: "second", model: received, options });
            return Effect.succeed(second);
          },
        },
      };

      const [firstResult, secondResult] = yield* Effect.all(
        [
          runPlugin({
            specifier: "fixture",
            exportName: "first",
            model,
            pluginOptions: { a: 1 },
          }),
          runPlugin({
            specifier: "fixture",
            exportName: "second",
            model,
            pluginOptions: { b: 2 },
          }),
        ],
        { concurrency: "unbounded" },
      ).pipe(loader(plugins));

      assert.strictEqual(firstResult, first);
      assert.strictEqual(secondResult, second);
      assert.equal(calls.length, 2);
      const byId = new Map(calls.map((call) => [call.id, call]));
      assert.strictEqual(byId.get("first")?.model, model);
      assert.strictEqual(byId.get("second")?.model, model);
      assert.deepEqual(byId.get("first")?.options, { a: 1 });
      assert.deepEqual(byId.get("second")?.options, { b: 2 });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("passes empty options when pluginOptions is omitted", () =>
    Effect.gen(function* () {
      const model = yield* loadService(source);

      const options = yield* runPlugin({ specifier: "fixture", exportName: "plugin", model }).pipe(
        loader({ plugin: { id: "plugin", generate: (_: ParsedService, opts: unknown) => opts } }),
      );

      assert.deepEqual(options, {});
    }).pipe(Effect.provide(layer)),
  );

  it.effect("maps plugin and loading failures to typed errors", () =>
    Effect.gen(function* () {
      const model = yield* loadService(source);

      const run = (load: () => Promise<unknown>) =>
        Effect.result(
          runPlugin({ specifier: "fixture", exportName: "plugin", model }).pipe(
            Effect.provideService(ModuleLoader, { load }),
          ),
        );

      const thrown = new Error("thrown");
      const failed = new Error("failed");
      const missing = new Error("missing");

      const throws = yield* run(() =>
        Promise.resolve({
          plugin: {
            id: "plugin",
            generate: () => {
              throw thrown;
            },
          },
        }),
      );

      const fails = yield* run(() =>
        Promise.resolve({ plugin: { id: "plugin", generate: () => Effect.fail(failed) } }),
      );

      const notFound = yield* run(() => Promise.reject(missing));
      const noExport = yield* run(() => Promise.resolve({}));

      assert.ok(Result.isFailure(throws));
      assert.equal(throws.failure._tag, "TransformError");
      assert.strictEqual(throws.failure.cause, thrown);
      assert.ok(Result.isFailure(fails));
      assert.equal(fails.failure._tag, "TransformError");
      assert.strictEqual(fails.failure.cause, failed);
      assert.ok(Result.isFailure(notFound));
      assert.equal(notFound.failure._tag, "MissingPlugin");
      assert.ok(Result.isFailure(noExport));
      assert.equal(noExport.failure._tag, "InvalidPlugin");
    }).pipe(Effect.provide(layer)),
  );
});
