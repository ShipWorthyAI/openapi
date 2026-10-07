import { NodeFileSystem } from "@effect/platform-node";
import { describe, it } from "@effect/vitest";
import { strict as assert } from "node:assert";
import { Effect, FileSystem, Layer, Path, Result, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import {
  OpenApiSource,
  bundleDocument,
  loadDocument,
  ParsedOpenApi,
  ParsedOpenApiFromString,
} from "../src/index.js";

const decode = Schema.decodeUnknownEffect(ParsedOpenApiFromString);
const encode = Schema.encodeEffect(ParsedOpenApiFromString);
const sourceUrl = "https://api.example.com/spec/openapi.yaml";
const layer = Layer.mergeAll(FileSystem.layerNoop({}), FetchHttpClient.layer);

function parse(source: string) {
  return decode(source).pipe(
    Effect.provideService(OpenApiSource, sourceUrl),
    Effect.provide(layer),
  );
}

const info = { title: "Pets", version: "1.0" };

describe("ParsedOpenApiFromString", () => {
  it.effect("accepts flow-style YAML, indented YAML, and JSON with a BOM", () =>
    Effect.gen(function* () {
      for (const source of [
        "{ openapi: 3.1.0, info: { title: Pets, version: '1.0' }, paths: {} }",
        "  openapi: 3.1.0\n  info: { title: Pets, version: '1.0' }\n  paths: {}\n",
        `\uFEFF  ${JSON.stringify({ openapi: "3.1.0", info, paths: {} })}`,
      ]) {
        assert.equal((yield* parse(source)).info.title, "Pets");
      }
    }),
  );

  it.effect("resolves relative references against cwd for inline source input", () =>
    Effect.gen(function* () {
      const files: string[] = [];

      const local = Layer.mergeAll(
        Path.layer,
        FetchHttpClient.layer,
        FileSystem.layerNoop({
          readFile: (file) => {
            files.push(file);
            return Effect.succeed(new TextEncoder().encode('{"type":"string"}'));
          },
        }),
      );

      const document = yield* loadDocument(
        JSON.stringify({
          openapi: "3.1.0",
          info,
          components: { schemas: { Pet: { $ref: "./pet.json" } } },
        }),
        { cwd: "/specs" },
      ).pipe(Effect.flatMap(bundleDocument), Effect.provide(local));

      assert.deepEqual(files, ["/specs/pet.json"]);
      assert.deepEqual(document.components?.schemas?.Pet, { type: "string" });
    }),
  );

  it.effect("decodes JSON and YAML to the same OpenAPI document and preserves extensions", () =>
    Effect.gen(function* () {
      const json = yield* parse(
        JSON.stringify({ openapi: "3.1.0", info, paths: {}, "x-owner": { team: "pets" } }),
      );

      const yaml = yield* parse(
        "openapi: 3.1.0\ninfo:\n  title: Pets\n  version: '1.0'\npaths: {}\nx-owner:\n  team: pets\n",
      );

      assert.deepEqual(yaml, json);
      assert.deepEqual(json["x-owner"], { team: "pets" });
      assert.equal(Object.hasOwn(json, "security"), false);
      assert.equal(Object.hasOwn(json, "servers"), false);
    }),
  );

  it.effect("upgrades 3.0 schemas before validating the 3.1 document", () =>
    Effect.gen(function* () {
      const document = yield* parse(
        JSON.stringify({
          openapi: "3.0.3",
          info,
          components: { schemas: { Name: { type: "string", nullable: true } } },
        }),
      );

      assert.equal(document.openapi, "3.1.0");
      assert.deepEqual(document.components?.schemas?.Name, { type: ["string", "null"] });
    }),
  );

  it.effect(
    "preserves boolean schemas through bundling, including aliases and inline schemas",
    () =>
      Effect.gen(function* () {
        const document = yield* parse(
          JSON.stringify({
            openapi: "3.1.0",
            info,
            components: {
              schemas: { Any: true, Never: false, Alias: { $ref: "#/components/schemas/Never" } },
            },
            paths: {
              "/pets": {
                get: {
                  responses: {
                    "200": {
                      description: "ok",
                      content: { "application/json": { schema: false } },
                    },
                  },
                },
              },
            },
          }),
        );

        assert.equal(document.components?.schemas?.Any, true);
        assert.equal(document.components?.schemas?.Never, false);

        assert.deepEqual(document.components?.schemas?.Alias, {
          $ref: "#/components/schemas/Never",
        });

        const response = document.paths?.["/pets"]?.get?.responses?.["200"];
        assert.ok(response && !response.$ref);
        assert.match(yield* encode(document), /"schema": false/);
      }),
  );

  it.effect("bundles HTTP references relative to the supplied source URL", () =>
    Effect.gen(function* () {
      const requests: string[] = [];

      const client = HttpClient.make((request) => {
        requests.push(request.url);

        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(
              JSON.stringify({
                description: "ok",
                content: { "application/json": { schema: { type: "string" } } },
              }),
            ),
          ),
        );
      });

      const document = yield* decode(
        JSON.stringify({
          openapi: "3.1.0",
          info,
          paths: { "/pets": { get: { responses: { "200": { $ref: "./responses/ok.json" } } } } },
        }),
      ).pipe(
        Effect.provideService(OpenApiSource, "http://localhost:3000/spec/openapi.yaml"),
        Effect.provide(
          Layer.mergeAll(FileSystem.layerNoop({}), Layer.succeed(HttpClient.HttpClient)(client)),
        ),
      );

      assert.deepEqual(requests, ["http://localhost:3000/spec/responses/ok.json"]);

      assert.equal(
        document.paths?.["/pets"]?.get?.responses?.["200"]?.$ref,
        "#/components/responses/ok",
      );

      assert.equal(document.components?.responses?.ok?.description, "ok");
    }),
  );

  it.effect("bundles file references using the root file URL", () =>
    Effect.gen(function* () {
      const document = yield* decode(
        JSON.stringify({
          openapi: "3.1.0",
          info,
          components: { schemas: { Pet: { $ref: "./fixtures/bundle-openapi/models/pet.yaml" } } },
        }),
      ).pipe(
        Effect.provideService(OpenApiSource, new URL("./openapi.json", import.meta.url).href),
        Effect.provide(Layer.mergeAll(NodeFileSystem.layer, FetchHttpClient.layer)),
      );

      assert.ok(document.components?.schemas?.Pet);
    }),
  );

  it.effect("encodes the prepared document as JSON and can decode it again", () =>
    Effect.gen(function* () {
      const document = yield* parse(
        "openapi: 3.0.3\ninfo: { title: Pets, version: '1.0' }\npaths: {}\n",
      );

      const json = yield* encode(document);
      assert.equal(JSON.parse(json).openapi, "3.1.0");
      assert.deepEqual(yield* parse(json), document);
    }),
  );

  it.effect("reports parsing, version, and resolution failures as SchemaError", () =>
    Effect.gen(function* () {
      for (const source of [
        "{ broken",
        "[]",
        "",
        JSON.stringify({ openapi: "3.2.0", info, paths: {} }),
        JSON.stringify({ openapi: "3.1.0", info, components: { schemas: { Invalid: 5 } } }),
      ]) {
        const error = yield* Effect.flip(parse(source));
        assert.equal(error._tag, "SchemaError");
      }

      const missing = yield* Effect.flip(
        parse(
          JSON.stringify({
            openapi: "3.1.0",
            info,
            paths: {
              "/pets": { get: { responses: { "200": { $ref: "file:///missing/Missing.json" } } } },
            },
          }),
        ),
      );

      assert.equal(missing._tag, "SchemaError");
      assert.match(missing.message, /Missing/);
    }),
  );

  it.effect("reports serialization failures in the error channel", () =>
    Effect.gen(function* () {
      const document = yield* parse(JSON.stringify({ openapi: "3.1.0", info, paths: {} }));
      const error = yield* Effect.flip(encode({ ...document, "x-bigint": 1n }));
      assert.equal(error._tag, "SchemaError");
    }),
  );
});

describe("OpenAPI 3.1 structure", () => {
  const validate = Schema.decodeUnknownResult(ParsedOpenApi);

  it("validates nested objects, Reference Objects, security schemes, and callback recursion", () => {
    const document = Schema.decodeUnknownSync(ParsedOpenApi)({
      openapi: "3.1.1",
      info,
      components: {
        securitySchemes: {
          oauth: {
            type: "oauth2",
            flows: {
              authorizationCode: { authorizationUrl: "/auth", tokenUrl: "/token", scopes: {} },
            },
          },
          oidc: { type: "openIdConnect", openIdConnectUrl: "/.well-known/openid-configuration" },
          mutual: { type: "mutualTLS" },
        },
        schemas: {
          Any: true,
          Never: false,
          Custom: { $ref: "#/components/schemas/Any", "custom-keyword": [1] },
        },
        headers: { Trace: { schema: { type: "string" } } },
      },
      paths: {
        "x-order": ["/pets"],
        "/pets": {
          post: {
            security: [],
            requestBody: {
              content: {
                "multipart/form-data": {
                  encoding: { pet: { headers: { Trace: { $ref: "#/components/headers/Trace" } } } },
                },
              },
            },
            responses: {
              default: { description: "ok" },
              "2XX": { $ref: "#/components/responses/Success", summary: "Success" },
              "x-order": ["default"],
            },
            callbacks: {
              onPet: {
                "{$request.body#/url}": {
                  post: { callbacks: { nested: { "{$request.body#/next}": { get: {} } } } },
                },
                "x-note": "callback",
              },
            },
          },
        },
      },
    });

    assert.deepEqual(document.paths?.["x-order"], ["/pets"]);
    assert.deepEqual(document.paths?.["/pets"]?.post?.security, []);
    assert.equal(document.components?.schemas?.Never, false);
  });

  it("rejects malformed document fields instead of silently dropping them", () => {
    const invalid = [
      { openapi: "3.1.0", paths: {} },
      { openapi: "3.1.0", info: { title: "Pets" }, paths: {} },
      { openapi: "3.1.0", info, servers: [{ description: "missing url" }] },
      {
        openapi: "3.1.0",
        info,
        components: { securitySchemes: { invalid: { type: "apiKey", in: "path", name: "key" } } },
      },
      {
        openapi: "3.1.0",
        info,
        paths: { "/pets": { get: { responses: { "200": { content: {} } } } } },
      },
      { openapi: "3.1.0", info, components: { schemas: { Invalid: "string" } } },
      { openapi: "3.1.0", info, paths: { pets: {} } },
      {
        openapi: "3.1.0",
        info,
        paths: { "/pets": { get: { responses: { invalid: { description: "ok" } } } } },
      },
    ];

    for (const document of invalid)
      assert.ok(Result.isFailure(validate(document)), JSON.stringify(document));
  });

  it("checks parameter requirements and preserves JSON Schema keywords without interpreting them", () => {
    const invalidParameter = { name: "id", in: "path", schema: {} };

    const invalid = validate({
      openapi: "3.1.0",
      info,
      components: { parameters: { Id: invalidParameter } },
    });

    assert.ok(Result.isFailure(invalid));

    const valid = validate({
      openapi: "3.1.0",
      info,
      components: {
        parameters: { Id: { ...invalidParameter, required: true } },
        schemas: { Custom: { $schema: "https://example.com/dialect", custom: 1 } },
      },
    });

    assert.ok(Result.isSuccess(valid));
  });
});
