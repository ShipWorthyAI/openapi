import { Readable } from "node:stream";
import { describe, it } from "@effect/vitest";
import { strict as assert } from "node:assert";
import { Effect, FileSystem, Layer, Path } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { loadDocument, parseModel, UnsupportedVersion } from "../src/index.js";

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

describe("parseModel", () => {
  it("reads operations, component schemas, webhooks, and $defs", () => {
    const model = parseModel({
      openapi: "3.1.0",
      info: { title: "Pets", version: "1.0.0" },
      tags: [{ name: "pets" }],
      security: [{ apiKey: [] }],
      components: {
        securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "X-Key" } },
        schemas: {
          Pet: { type: "object", properties: { name: { type: "string" } } },
          Flag: true,
        },
        parameters: {
          Id: { name: "id", in: "path", required: true, schema: { type: "string" } },
        },
      },
      paths: {
        "/pets/{id}": {
          parameters: [{ $ref: "#/components/parameters/Id" }],
          get: {
            operationId: "getPet",
            parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
            responses: {
              "200": {
                description: "ok",
                content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } },
              },
            },
          },
        },
      },
      webhooks: {
        newPet: { post: { operationId: "newPet", responses: { "200": { description: "ok" } } } },
      },
      $defs: { Name: { type: "string" } },
    });

    assert.strictEqual(model.openapi, "3.1.0");
    assert.strictEqual(model.info.title, "Pets");
    assert.deepStrictEqual(model.tags, [{ name: "pets", extensions: {} }]);

    assert.deepStrictEqual(model.securitySchemes.apiKey, {
      type: "apiKey",
      in: "header",
      name: "X-Key",
      extensions: {},
    });

    assert.deepStrictEqual(model.components.schemas.Pet, {
      type: "object",
      properties: { name: { type: "string" } },
    });

    assert.strictEqual(model.components.schemas.Flag, true);

    assert.deepStrictEqual(model.components.parameters.Id, {
      name: "id",
      in: "path",
      required: true,
      deprecated: false,
      schema: { type: "string" },
      contents: [],
      examples: [],
      extensions: {},
    });

    assert.deepStrictEqual(model.paths["/pets/{id}"]?.get, {
      operationId: "getPet",
      parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
      responses: {
        "200": {
          description: "ok",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } },
        },
      },
    });

    assert.deepStrictEqual(model.webhooks.newPet, {
      post: { operationId: "newPet", responses: { "200": { description: "ok" } } },
      extensions: {},
    });

    assert.deepStrictEqual(model.$defs.Name, { type: "string" });

    assert.strictEqual(model.operations.length, 1);
    assert.strictEqual(model.operations[0]?.operationId, "getPet");
    assert.strictEqual(model.operations[0]?.method, "GET");
    assert.strictEqual(model.operations[0]?.path, "/pets/{id}");

    assert.strictEqual(model.operations[0]?.parameters.path[0]?.name, "id");
    assert.strictEqual(model.operations[0]?.parameters.path[0]?.required, true);
    assert.deepStrictEqual(model.operations[0]?.parameters.query[0]?.schema, { type: "integer" });

    assert.deepStrictEqual(model.operations[0]?.responses[0]?.contents, [
      {
        mediaType: "application/json",
        schema: { $ref: "#/components/schemas/Pet" },
        examples: [],
        encodings: [],
        extensions: {},
      },
    ]);
  });

  it.effect("keeps component responses, request bodies, headers, and path items", () =>
    Effect.gen(function* () {
      const model = parseModel({
        openapi: "3.1.0",
        info: { title: "Pets", version: "1.0.0" },
        components: {
          responses: { Error: { description: "nope" } },
          requestBodies: { Pet: { required: true, content: {} } },
          headers: { Rate: { schema: { type: "integer" } } },
          pathItems: { Health: { get: { responses: { "204": { description: "ok" } } } } },
        },
        webhooks: {
          newPet: { post: { operationId: "newPet", responses: { "200": { description: "ok" } } } },
        },
      });

      assert.deepStrictEqual(model.components.responses.Error, {
        description: "nope",
        headers: {},
        contents: [],
        links: {},
        extensions: {},
      });

      assert.deepStrictEqual(model.components.requestBodies.Pet, {
        required: true,
        contents: [],
        extensions: {},
      });

      assert.deepStrictEqual(model.components.headers.Rate, {
        required: false,
        deprecated: false,
        schema: { type: "integer" },
        contents: [],
        examples: [],
        extensions: {},
      });

      assert.deepStrictEqual(model.components.pathItems.Health, {
        get: { responses: { "204": { description: "ok" } } },
        extensions: {},
      });

      assert.deepStrictEqual(model.webhooks.newPet, {
        post: { operationId: "newPet", responses: { "200": { description: "ok" } } },
        extensions: {},
      });

      yield* Effect.void;
    }),
  );

  it.effect("reads info, servers, security, and operation metadata", () =>
    Effect.gen(function* () {
      const model = parseModel({
        openapi: "3.1.0",
        info: {
          title: "Pets",
          version: "1.0.0",
          summary: "A pet store",
          description: "Pets for sale",
          license: { name: "MIT", url: "https://example.com/license" },
        },
        servers: [
          {
            url: "https://example.com/{version}",
            description: "Production",
            variables: {
              version: { default: "v1", enum: ["v1", "v2"], description: "API version" },
            },
          },
        ],
        tags: [
          {
            name: "pets",
            description: "Pet operations",
            externalDocs: { url: "https://example.com/pets", description: "Pet docs" },
          },
        ],
        security: [{ apiKey: [] }],
        components: {
          securitySchemes: {
            apiKey: { type: "apiKey", in: "header", name: "X-Key", description: "Key" },
            bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
            oauth: {
              type: "oauth2",
              flows: { implicit: { authorizationUrl: "https://example.com/auth", scopes: {} } },
            },
            oidc: {
              type: "openIdConnect",
              openIdConnectUrl: "https://example.com/.well-known/openid-configuration",
            },
            broken: { type: "apiKey", in: "path", name: "nope" },
          },
        },
        paths: {
          "/pets": {
            get: {
              operationId: "listPets",
              tags: ["pets"],
              summary: "List pets",
              description: "Returns pets",
              deprecated: true,
              externalDocs: { url: "https://example.com/list" },
              parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
              responses: {
                "200": { description: "ok" },
                default: { description: "error" },
              },
            },
            post: {
              operationId: "createPet",
              security: [{ bearer: [] }],
              responses: { "201": { description: "created" } },
            },
            delete: {
              operationId: "deletePet",
              security: [],
              responses: { "204": { description: "gone" } },
            },
          },
        },
      });

      assert.deepStrictEqual(model.info, {
        title: "Pets",
        version: "1.0.0",
        summary: "A pet store",
        description: "Pets for sale",
        license: { name: "MIT", url: "https://example.com/license", extensions: {} },
        extensions: {},
      });

      assert.deepStrictEqual(model.servers, [
        {
          url: "https://example.com/{version}",
          description: "Production",
          variables: {
            version: {
              default: "v1",
              enum: ["v1", "v2"],
              description: "API version",
              extensions: {},
            },
          },
          extensions: {},
        },
      ]);

      assert.deepStrictEqual(model.tags, [
        {
          name: "pets",
          description: "Pet operations",
          externalDocs: {
            url: "https://example.com/pets",
            description: "Pet docs",
            extensions: {},
          },
          extensions: {},
        },
      ]);

      assert.deepStrictEqual(model.securitySchemes.bearer, {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        extensions: {},
      });

      assert.deepStrictEqual(model.securitySchemes.oauth, {
        type: "oauth2",
        flows: {
          implicit: {
            authorizationUrl: "https://example.com/auth",
            scopes: {},
            extensions: {},
          },
          extensions: {},
        },
        extensions: {},
      });

      assert.deepStrictEqual(model.securitySchemes.oidc, {
        type: "openIdConnect",
        openIdConnectUrl: "https://example.com/.well-known/openid-configuration",
        extensions: {},
      });

      assert.strictEqual(model.securitySchemes.broken, undefined);

      const list = model.operations.find((operation) => operation.operationId === "listPets");
      const create = model.operations.find((operation) => operation.operationId === "createPet");
      const remove = model.operations.find((operation) => operation.operationId === "deletePet");

      assert.deepStrictEqual(list?.tags, ["pets"]);

      assert.deepStrictEqual(list?.metadata, {
        summary: "List pets",
        description: "Returns pets",
        deprecated: true,
        externalDocs: { url: "https://example.com/list", extensions: {} },
      });

      assert.strictEqual(list?.parameters.query[0]?.in, "query");
      assert.deepStrictEqual(list?.security, [{ apiKey: [] }]);

      assert.deepStrictEqual(list?.defaultResponse, {
        description: "error",
        headers: {},
        contents: [],
        links: {},
        extensions: {},
      });

      assert.strictEqual(list?.securityDeclaration, "inherited");
      assert.strictEqual(create?.securityDeclaration, "declared");
      assert.strictEqual(remove?.securityDeclaration, "none");

      assert.deepStrictEqual(create?.security, [{ bearer: [] }]);
      assert.deepStrictEqual(remove?.security, []);
      assert.strictEqual(remove?.metadata.deprecated, false);

      yield* Effect.void;
    }),
  );

  it.effect("keeps content, encodings, links, callbacks, and extensions", () =>
    Effect.gen(function* () {
      const model = parseModel({
        openapi: "3.1.0",
        info: {
          title: "Pets",
          version: "1.0.0",
          contact: { name: "Ada", email: "ada@example.com" },
          "x-internal": true,
        },
        components: {
          securitySchemes: {
            mtls: { type: "mutualTLS", description: "Client cert" },
          },
          callbacks: {
            pet: {
              "{$request.body#/callback}": {
                post: { operationId: "onPet", responses: { "200": { description: "ok" } } },
              },
            },
          },
        },
        paths: {
          "/pets": {
            post: {
              operationId: "createPet",
              "x-feature": "beta",
              parameters: [
                {
                  name: "limit",
                  in: "query",
                  style: "form",
                  explode: false,
                  content: { "application/json": { schema: { type: "integer" } } },
                },
              ],
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: { type: "object" },
                    example: { name: "Fido" },
                    encoding: {
                      name: { contentType: "text/plain", style: "form", explode: true },
                    },
                  },
                },
              },
              responses: {
                "200": {
                  description: "ok",
                  links: { next: { operationId: "getPet", description: "Follow" } },
                },
              },
            },
          },
        },
      });

      assert.deepStrictEqual(model.info.contact, {
        name: "Ada",
        email: "ada@example.com",
        extensions: {},
      });

      assert.deepStrictEqual(model.info.extensions, { "x-internal": true });

      assert.deepStrictEqual(model.securitySchemes.mtls, {
        type: "mutualTLS",
        description: "Client cert",
        extensions: {},
      });

      assert.strictEqual(
        model.components.callbacks.pet?.expressions["{$request.body#/callback}"]?.post !==
          undefined,
        true,
      );

      const operation = model.operations[0];
      const parameter = operation?.parameters.query[0];

      assert.strictEqual(parameter?.style, "form");
      assert.strictEqual(parameter?.explode, false);
      assert.strictEqual(parameter?.contents[0]?.mediaType, "application/json");
      assert.deepStrictEqual(parameter?.contents[0]?.schema, { type: "integer" });
      assert.deepStrictEqual(operation?.extensions, { "x-feature": "beta" });

      const media = operation?.requestBody?.contents[0];

      assert.strictEqual(media?.mediaType, "application/json");
      assert.deepStrictEqual(media?.example, { name: "Fido" });
      assert.strictEqual(media?.examples[0]?.name, "default");

      assert.deepStrictEqual(media?.encodings[0], {
        property: "name",
        contentType: "text/plain",
        style: "form",
        explode: true,
        headers: {},
        extensions: {},
      });

      assert.deepStrictEqual(operation?.responses[0]?.links.next, {
        operationId: "getPet",
        description: "Follow",
        extensions: {},
      });

      yield* Effect.void;
    }),
  );

  it("resolves percent-encoded and escaped JSON Pointer refs", () => {
    const model = parseModel({
      openapi: "3.1.0",
      info: { title: "Pets", version: "1.0.0" },
      components: {
        responses: { café: { description: "ok" } },
      },
      paths: {
        "/pets": {
          get: {
            operationId: "getPet",
            responses: { "200": { $ref: "#/components/responses/caf%C3%A9" } },
          },
        },
        "/foo bar": { get: { operationId: "spaced", responses: { "204": { description: "ok" } } } },
        "/alias": { $ref: "#/paths/~1foo bar" },
      },
    });

    assert.strictEqual(model.operations[0]?.responses[0]?.description, "ok");

    assert.strictEqual(
      (model.paths["/alias"]?.get as { operationId?: string } | undefined)?.operationId,
      "spaced",
    );
  });

  it("throws UnsupportedVersion for a rejected document", () => {
    assert.throws(
      () => parseModel({ swagger: "2.0" }),
      (error: unknown) => error instanceof UnsupportedVersion,
    );

    assert.throws(
      () => parseModel({ swagger: "2.0" }),
      (error: unknown) =>
        error instanceof UnsupportedVersion &&
        error.message === "Unsupported Swagger version: 2.x. Use OpenAPI 3.x instead.",
    );
  });
});
