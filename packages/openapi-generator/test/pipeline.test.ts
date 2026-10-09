import { describe, it } from "@effect/vitest";
import { ParsedService } from "@shipworthy/openapi-transformer";
import { Effect, FileSystem, Layer, Path, PlatformError, Result, Schema } from "effect";
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

describe("generator path sources", () => {
  const files: Record<string, string> = {
    "/specs/api/openapi.yaml":
      "openapi: 3.0.3\ninfo: { title: Pets, version: '1' }\ncomponents:\n  schemas:\n    Pet: { $ref: ./models/pet.yaml }\n",
    "/specs/api/models/pet.yaml": "type: string\nnullable: true\n",
  };

  const read = (file: string) =>
    file in files
      ? Effect.succeed(files[file] ?? "")
      : Effect.fail(
          PlatformError.systemError({
            _tag: "NotFound",
            module: "FileSystem",
            method: "readFile",
            pathOrDescriptor: file,
          }),
        );

  const memoryLayer = (reads: string[]) =>
    Layer.mergeAll(
      FileSystem.layerNoop({
        readFileString: (file) => {
          reads.push(file);
          return read(file);
        },
        readFile: (file) => {
          reads.push(file);
          return Effect.map(read(file), (text) => new TextEncoder().encode(text));
        },
      }),
      Path.layer,
      FetchHttpClient.layer,
    );

  for (const [source, cwd] of [
    ["./api/openapi.yaml", "/specs"],
    ["api/openapi.yaml", "/specs"],
    ["../api/openapi.yaml", "/specs/other"],
    ["/specs/api/openapi.yaml", undefined],
  ] as const) {
    it.effect(`loads ${source} as a file and resolves refs against it`, () =>
      Effect.gen(function* () {
        const reads: string[] = [];

        const model = yield* modelSchema(
          yield* generate({ specifier: "fixture", exportName: "plugin", source, cwd }).pipe(
            Effect.provideService(ModuleLoader, { load: () => Promise.resolve({ plugin }) }),
            Effect.provide(memoryLayer(reads)),
          ),
        );

        assert.deepEqual(reads, ["/specs/api/openapi.yaml", "/specs/api/models/pet.yaml"]);
        assert.equal(model.openapi, "3.1.0");
        assert.deepEqual(model.components.schemas.Pet, { type: ["string", "null"] });
      }),
    );
  }

  it.effect("fails with ResolveError when the path does not exist", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        generate({ specifier: "fixture", exportName: "plugin", source: "./missing.json" }).pipe(
          Effect.provideService(ModuleLoader, { load: () => Promise.resolve({ plugin }) }),
          Effect.provide(memoryLayer([])),
        ),
      );

      assert.ok(Result.isFailure(result));
      const error = result.failure;
      assert.equal(error._tag, "ResolveError");
      assert.match(error.message, /missing\.json/);
    }),
  );
});
