import { describe, it } from "@effect/vitest";
import { ParsedService } from "@shipworthy/openapi-transformer";
import { Effect, FileSystem, Layer, Path, Result, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { strict as assert } from "node:assert";
import { generate, ModuleLoader, type Generator } from "../src/index.js";

const plugin: Generator<ParsedService> = { id: "fixture", generate: (model) => model };
const layer = Layer.mergeAll(FileSystem.layerNoop({}), Path.layer, FetchHttpClient.layer);
const modelSchema = Schema.decodeUnknownEffect(ParsedService);

function run(source: unknown) {
  return generate({ specifier: "fixture", exportName: "plugin", source }).pipe(
    Effect.provideService(ModuleLoader, { load: () => Promise.resolve({ plugin }) }),
    Effect.provide(layer),
  );
}

describe("generator preparation", () => {
  it.effect(
    "passes a bundled, upgraded service to the generator for JSON, YAML, and object input",
    () =>
      Effect.gen(function* () {
        const input = {
          openapi: "3.0.3",
          info: { title: "Pets", version: "1" },
          components: { schemas: { Name: { type: "string", nullable: true } } },
        };

        const object = yield* modelSchema(yield* run(input));
        const json = yield* modelSchema(yield* run(JSON.stringify(input)));

        const yaml = yield* modelSchema(
          yield* run(
            "openapi: 3.0.3\ninfo: { title: Pets, version: '1' }\ncomponents:\n  schemas:\n    Name: { type: string, nullable: true }\n",
          ),
        );

        assert.equal(object.openapi, "3.1.0");
        assert.deepEqual(object.components.schemas.Name, { type: ["string", "null"] });
        assert.deepEqual(object, json);
        assert.deepEqual(object, yaml);
        assert.equal(input.openapi, "3.0.3");
        assert.equal(input.components.schemas.Name.nullable, true);
      }),
  );

  it.effect("does not serialize object input", () =>
    Effect.gen(function* () {
      const model = yield* modelSchema(
        yield* run({
          openapi: "3.1.0",
          info: { title: "Pets", version: "1" },
          paths: {},
          "x-value": 1n,
        }),
      );

      assert.equal(model.extensions["x-value"], 1n);
    }),
  );

  it.effect("rejects malformed input before loading the generator", () =>
    Effect.gen(function* () {
      let loaded = false;

      const result = yield* Effect.result(
        generate({
          specifier: "fixture",
          exportName: "plugin",
          source: { openapi: "3.1.0", info: { title: "Pets" }, paths: {} },
        }).pipe(
          Effect.provideService(ModuleLoader, {
            load: () => {
              loaded = true;
              return Promise.resolve({ plugin });
            },
          }),
          Effect.provide(layer),
        ),
      );

      assert.ok(Result.isFailure(result));
      const error = result.failure;
      assert.equal(error._tag, "ResolveError");
      assert.match(error.message, /info.*version/s);
      assert.equal(loaded, false);
    }),
  );
});
