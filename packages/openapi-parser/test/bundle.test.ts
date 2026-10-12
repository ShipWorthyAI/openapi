import nodePath from "node:path";
import { Readable } from "node:stream";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import { strict as assert } from "node:assert";
import { Effect, FileSystem, Layer, Path } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { bundleDocument } from "../src/index.ts";

const layer = Layer.mergeAll(FileSystem.layerNoop({}), Path.layer, FetchHttpClient.layer);

const fileLayer = Layer.mergeAll(
  FileSystem.layerNoop({
    readFile: () =>
      Effect.succeed(
        new TextEncoder().encode(
          '{"openapi":"3.1.0","info":{"title":"Pets","version":"1"},"paths":{}}',
        ),
      ),
  }),
  Path.layer,
  FetchHttpClient.layer,
);

const nodeLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, FetchHttpClient.layer);
const fixtures = nodePath.resolve(import.meta.dirname, "fixtures/bundle-openapi");
const rootPath = nodePath.join(fixtures, "root.yaml");

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
  it.effect("preserves keywords alongside schema references without introducing allOf", () =>
    Effect.gen(function* () {
      const siblings = {
        $ref: "#/components/schemas/Id",
        description: "Original booking ID",
        minLength: 3,
        readOnly: true,
        "x-label": "original",
      };

      const document = yield* bundleDocument({
        openapi: "3.1.0",
        info: { title: "Bookings", version: "1" },
        paths: {},
        components: {
          schemas: {
            Id: { type: "string" },
            Booking: { type: "object", properties: { original_id: siblings } },
            LabelledId: siblings,
          },
        },
      });

      assert.deepEqual(document.components?.schemas?.Booking, {
        type: "object",
        properties: { original_id: siblings },
      });

      assert.deepEqual(document.components?.schemas?.LabelledId, siblings);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("validates references inside sibling schema keywords", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        bundleDocument({
          openapi: "3.1.0",
          info: { title: "Nested siblings", version: "1" },
          paths: {},
          components: {
            schemas: {
              Base: { type: "object" },
              Extended: {
                $ref: "#/components/schemas/Base",
                properties: { missing: { $ref: "#/components/schemas/Missing" } },
              },
            },
          },
        }),
      );

      assert.match(error.message, /Missing/);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("reports invalid cwd options through SchemaError", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        bundleDocument({ openapi: "3.1.0", info: { title: "Options", version: "1" }, paths: {} }, {
          cwd: 42,
        } as never),
      );

      assert.equal(error._tag, "SchemaError");
      assert.match(error.message, /cwd/);
    }).pipe(Effect.provide(layer)),
  );

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

  it.effect("preserves literal hashes in root file URLs and path strings", () =>
    Effect.gen(function* () {
      const files: string[] = [];

      const contents = new TextEncoder().encode(
        JSON.stringify({
          openapi: "3.1.0",
          info: { title: "Hash filename", version: "1" },
          paths: {},
        }),
      );

      const local = Layer.mergeAll(
        FileSystem.layerNoop({
          readFile: (file) => {
            files.push(file);
            assert.equal(file, "/specs/open#api.json");
            return Effect.succeed(contents);
          },
        }),
        Path.layer,
        FetchHttpClient.layer,
      );

      yield* Effect.forEach(
        [new URL("file:///specs/open%23api.json"), "/specs/open#api.json"],
        Effect.fnUntraced(function* (source) {
          const document = yield* bundleDocument(source).pipe(Effect.provide(local));
          assert.equal(document.info.title, "Hash filename");
        }),
        { discard: true },
      );

      assert.deepEqual(files, ["/specs/open#api.json", "/specs/open#api.json"]);
    }),
  );

  it.effect("parses BOM-prefixed YAML in both root and referenced JSON files", () =>
    Effect.gen(function* () {
      const files: string[] = [];

      const contents: Record<string, string> = {
        "/specs/openapi.json":
          "\uFEFFopenapi: 3.1.0\ninfo: { title: Pets, version: '1' }\ncomponents:\n  schemas:\n    Pet: { $ref: './pet.json' }\n",
        "/specs/pet.json": "\uFEFFtype: string\n",
      };

      const local = Layer.mergeAll(
        FileSystem.layerNoop({
          readFile: (file) => {
            files.push(file);
            return Effect.succeed(new TextEncoder().encode(contents[file]));
          },
        }),
        Path.layer,
        FetchHttpClient.layer,
      );

      const document = yield* bundleDocument("/specs/openapi.json").pipe(Effect.provide(local));
      assert.equal(document.info.title, "Pets");
      assert.deepEqual(document.components?.schemas?.Pet, { type: "string" });
      assert.deepEqual(files, ["/specs/openapi.json", "/specs/pet.json"]);
    }),
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

describe("bundleDocument with a filesystem path string", () => {
  const expectBundled = (document: Effect.Success<ReturnType<typeof bundleDocument>>) => {
    assert.equal(document.info.title, "Pets");

    assert.deepEqual(document.components?.parameters?.limit, {
      name: "limit",
      in: "query",
      schema: { type: "integer" },
    });
  };

  it.effect("loads an absolute path and resolves its relative $refs against the file", () =>
    Effect.gen(function* () {
      expectBundled(yield* bundleDocument(rootPath, { cwd: "/nonexistent" }));
    }).pipe(Effect.provide(nodeLayer)),
  );

  it.effect("loads a ./ path relative to the process cwd", () =>
    Effect.gen(function* () {
      const relative = `./${nodePath.relative(process.cwd(), rootPath)}`;
      expectBundled(yield* bundleDocument(relative));
    }).pipe(Effect.provide(nodeLayer)),
  );

  it.effect("loads ../ and bare-name paths relative to the cwd option", () =>
    Effect.gen(function* () {
      expectBundled(
        yield* bundleDocument("../../bundle-openapi/root.yaml", { cwd: `${fixtures}/models` }),
      );

      expectBundled(yield* bundleDocument("root.yaml", { cwd: fixtures }));
      expectBundled(yield* bundleDocument("  root.yaml\t", { cwd: fixtures }));
    }).pipe(Effect.provide(nodeLayer)),
  );

  it.effect("reads the path through FileSystem", () =>
    Effect.gen(function* () {
      const files: string[] = [];

      const local = Layer.mergeAll(
        FileSystem.layerNoop({
          readFile: (file) => {
            files.push(file);

            return Effect.succeed(
              new TextEncoder().encode('{"openapi":"3.1.0","info":{"title":"Pets","version":"1"}}'),
            );
          },
        }),
        Path.layer,
        FetchHttpClient.layer,
      );

      yield* Effect.forEach(
        ["./openapi.json", "/specs/openapi.json", "specs/openapi.YML"],
        Effect.fnUntraced(function* (source) {
          const document = yield* bundleDocument(source, { cwd: "/specs" }).pipe(
            Effect.provide(local),
          );

          assert.equal(document.info.title, "Pets");
        }),
        { discard: true },
      );

      assert.deepEqual(files, [
        "/specs/openapi.json",
        "/specs/openapi.json",
        "/specs/specs/openapi.YML",
      ]);
    }),
  );

  it.effect("fails with the file error when the path does not exist", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(bundleDocument("./missing.yaml", { cwd: fixtures }));
      assert.strictEqual(error._tag, "SchemaError");
      assert.match(error.message, /missing\.yaml/);
    }).pipe(Effect.provide(nodeLayer)),
  );

  it.effect("still parses one-line inline documents as text", () =>
    Effect.gen(function* () {
      yield* Effect.forEach(
        [
          "{ openapi: 3.1.0, info: { title: Pets, version: '1' }, servers: [{ url: /api.json }] }",
          '{"openapi":"3.1.0","info":{"title":"Pets","version":"1"},"x-file":"a.yaml"}',
        ],
        Effect.fnUntraced(function* (source) {
          const document = yield* bundleDocument(source);
          assert.equal(document.info.title, "Pets");
        }),
        { discard: true },
      );

      const scalar = yield* Effect.flip(bundleDocument("x-file: a.yaml"));
      assert.match(scalar.message, /openapi/);
    }).pipe(Effect.provide(layer)),
  );
});
