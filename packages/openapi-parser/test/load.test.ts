import { Readable } from "node:stream";
import { describe, it } from "@effect/vitest";
import { strict as assert } from "node:assert";
import { Effect, FileSystem, Layer, Path } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { loadDocument } from "../src/index.js";

const layer = Layer.mergeAll(FileSystem.layerNoop({}), Path.layer, FetchHttpClient.layer);

const fileLayer = Layer.mergeAll(
  FileSystem.layerNoop({
    readFileString: () => Effect.succeed('{"openapi":"3.1.0"}'),
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

describe("loadDocument", () => {
  it.effect("rejects an empty source", () =>
    Effect.gen(function* () {
      const empty = yield* Effect.flip(loadDocument(""));
      const missing = yield* Effect.flip(loadDocument(undefined));

      assert.strictEqual(empty._tag, "EmptySource");
      assert.strictEqual(empty.message, "Empty schema. Please specify a URL or file path");
      assert.strictEqual(missing._tag, "EmptySource");
      assert.strictEqual(missing.message, "Empty schema. Please specify a URL or file path");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rejects Swagger 2", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(loadDocument({ swagger: "2.0" }));

      assert.strictEqual(error._tag, "UnsupportedVersion");

      assert.strictEqual(
        error.message,
        "Unsupported Swagger version: 2.x. Use OpenAPI 3.x instead.",
      );
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rejects a missing openapi version", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(loadDocument({}));
      assert.strictEqual(error._tag, "UnsupportedVersion");
      assert.strictEqual(error.message, "Unsupported schema format, expected `openapi: 3.x`");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rejects OpenAPI 2", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        loadDocument({ openapi: "2.0", info: { title: "Test", version: "1.0" } }),
      );

      assert.strictEqual(error._tag, "UnsupportedVersion");
      assert.strictEqual(error.message, "Unsupported OpenAPI version: 2.0");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("reads a file URL through FileSystem", () =>
    Effect.gen(function* () {
      const loaded = yield* loadDocument(new URL("file:///tmp/openapi.json"));
      assert.strictEqual(loaded.document.openapi, "3.1.0");
      assert.strictEqual(loaded.sourceText, '{"openapi":"3.1.0"}');
    }).pipe(Effect.provide(fileLayer)),
  );

  it.effect("reads a Node Readable", () =>
    Effect.gen(function* () {
      const loaded = yield* loadDocument(
        Readable.from([new TextEncoder().encode('{"openapi":"3.0.0"}')]),
      );

      assert.strictEqual(loaded.document.openapi, "3.0.0");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rejects JSON that is not an object", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(loadDocument("[]"));
      assert.strictEqual(error._tag, "InvalidSource");
      assert.strictEqual(error.message, "Expected an OpenAPI document object. Got Array");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("maps a non-OK HTTP response to ParseError", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(loadDocument("http://example.com/openapi.yaml"));
      assert.strictEqual(error._tag, "ParseError");
      assert.ok(error.cause);
      assert.match(error.message, /404/);
    }).pipe(Effect.provide(httpLayer)),
  );
});
