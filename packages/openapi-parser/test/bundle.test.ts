import { Readable } from "node:stream";
import { describe, it } from "@effect/vitest";
import { strict as assert } from "node:assert";
import { Effect, FileSystem, Layer, Path } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { bundleDocument } from "../src/index.js";

const layer = Layer.mergeAll(FileSystem.layerNoop({}), Path.layer, FetchHttpClient.layer);

const fileLayer = Layer.mergeAll(
  FileSystem.layerNoop({
    readFileString: () =>
      Effect.succeed('{"openapi":"3.1.0","info":{"title":"Pets","version":"1"},"paths":{}}'),
  }),
  Path.layer,
  FetchHttpClient.layer,
);

const notFound = HttpClient.make((request) =>
  Effect.succeed(
    HttpClientResponse.fromWeb(request, new Response("", { status: 404, statusText: "Not Found" })),
  ),
);

const httpLayer = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  Layer.succeed(HttpClient.HttpClient)(notFound),
);

describe("bundleDocument", () => {
  it.effect("rejects an empty source", () =>
    Effect.gen(function* () {
      const empty = yield* Effect.flip(bundleDocument(""));
      const missing = yield* Effect.flip(bundleDocument(undefined));

      assert.strictEqual(empty._tag, "SchemaError");
      assert.strictEqual(empty.message, "Empty schema. Please specify a URL or file path");
      assert.strictEqual(missing._tag, "SchemaError");
      assert.strictEqual(missing.message, "Empty schema. Please specify a URL or file path");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rejects Swagger 2", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(bundleDocument({ swagger: "2.0" }));

      assert.strictEqual(error._tag, "SchemaError");

      assert.strictEqual(
        error.message,
        "Unsupported Swagger version: 2.x. Use OpenAPI 3.x instead.",
      );
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rejects a missing openapi version", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(bundleDocument({}));
      assert.strictEqual(error._tag, "SchemaError");
      assert.strictEqual(error.message, "Unsupported schema format, expected `openapi: 3.x`");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rejects OpenAPI 2", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        bundleDocument({ openapi: "2.0", info: { title: "Test", version: "1.0" } }),
      );

      assert.strictEqual(error._tag, "SchemaError");
      assert.strictEqual(error.message, "Unsupported OpenAPI version: 2.0");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("reads a file URL through FileSystem", () =>
    Effect.gen(function* () {
      const loaded = yield* bundleDocument(new URL("file:///tmp/openapi.json"));
      assert.strictEqual(loaded.openapi, "3.1.0");
      assert.equal(loaded.info.title, "Pets");
    }).pipe(Effect.provide(fileLayer)),
  );

  it.effect("reads a Node Readable", () =>
    Effect.gen(function* () {
      const loaded = yield* bundleDocument(
        Readable.from([
          new TextEncoder().encode(
            '{"openapi":"3.0.0","info":{"title":"Pets","version":"1"},"paths":{}}',
          ),
        ]),
      );

      assert.strictEqual(loaded.openapi, "3.1.0");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("loads a Buffer and prepares its document", () =>
    Effect.gen(function* () {
      const document = yield* bundleDocument(
        Buffer.from(
          JSON.stringify({
            openapi: "3.0.3",
            info: { title: "Pets", version: "1" },
            paths: {},
          }),
        ),
      );

      assert.equal(document.openapi, "3.1.0");
      assert.equal(document.info.title, "Pets");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("loads an HTTP root and resolves its relative references", () =>
    Effect.gen(function* () {
      const requests: string[] = [];

      const client = HttpClient.make((request) => {
        requests.push(request.url);

        const data = request.url.endsWith("openapi.json")
          ? {
              openapi: "3.1.0",
              info: { title: "Pets", version: "1" },
              components: { schemas: { Pet: { $ref: "./pet.json" } } },
            }
          : { type: "string" };

        return Effect.succeed(
          HttpClientResponse.fromWeb(request, new Response(JSON.stringify(data))),
        );
      });

      const document = yield* bundleDocument(
        new URL("http://localhost:3000/spec/openapi.json"),
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            FileSystem.layerNoop({}),
            Path.layer,
            Layer.succeed(HttpClient.HttpClient)(client),
          ),
        ),
      );

      assert.deepEqual(requests, [
        "http://localhost:3000/spec/openapi.json",
        "http://localhost:3000/spec/pet.json",
      ]);

      assert.deepEqual(document.components?.schemas?.Pet, { type: "string" });
    }),
  );

  it.effect("rejects JSON that is not an object", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(bundleDocument("[]"));
      assert.strictEqual(error._tag, "SchemaError");
      assert.strictEqual(error.message, "Expected an OpenAPI document object. Got Array");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("maps a non-OK HTTP response to SchemaError", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(bundleDocument("http://example.com/openapi.yaml"));
      assert.strictEqual(error._tag, "SchemaError");
      assert.match(error.message, /404/);
    }).pipe(Effect.provide(httpLayer)),
  );
});
