import { describe, it } from "@effect/vitest";
import { strict as assert } from "node:assert";
import { Effect, Schema } from "effect";
import type { OpenAPIDocument } from "@shipworthy/openapi-parser";
import { decode, InvalidSchema, ParsedService } from "../src/index.js";

/** Decode a document that is expected to succeed. */
const decodeModel = (document: OpenAPIDocument) => Effect.runSync(decode(document));

/** The error decoding a document fails with. */
const decodeError = (document: OpenAPIDocument) => Effect.runSync(Effect.flip(decode(document)));

const info = { title: "Pets", version: "1.0.0" };

describe("decode service", () => {
  it("flattens info onto the service and keeps servers, tags, and security schemes", () => {
    const model = decodeModel({
      openapi: "3.1.0",
      info: {
        ...info,
        summary: "A pet store",
        description: "Pets for sale",
        termsOfService: "https://example.com/terms",
        contact: { name: "Ada", email: "ada@example.com" },
        license: { name: "MIT", url: "https://example.com/license" },
        "x-internal": true,
      },
      externalDocs: { url: "https://example.com/docs" },
      servers: [
        {
          url: "https://example.com/{version}",
          description: "Production",
          variables: { version: { default: "v1", enum: ["v1", "v2"] } },
        },
      ],
      tags: [{ name: "pets", description: "Pet operations" }],
      security: [{ apiKey: [] }, { oauth: ["read"], unknown: [] }],
      components: {
        securitySchemes: {
          apiKey: { type: "apiKey", in: "header", name: "X-Key" },
          bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
          oauth: {
            type: "oauth2",
            flows: {
              implicit: { authorizationUrl: "https://example.com/auth", scopes: { read: "Read" } },
            },
          },
          oidc: { type: "openIdConnect", openIdConnectUrl: "https://example.com/oidc" },
          mtls: { type: "mutualTLS", description: "Client cert" },
          broken: { type: "apiKey", in: "path", name: "nope" },
        },
      },
      "x-root": 1,
    });

    assert.strictEqual(model.id, "#");
    assert.strictEqual(model.name, "Pets");
    assert.strictEqual(model.version, "1.0.0");
    assert.strictEqual(model.summary, "A pet store");
    assert.strictEqual(model.description, "Pets for sale");
    assert.strictEqual(model.termsOfService, "https://example.com/terms");

    assert.deepStrictEqual(model.contact, {
      name: "Ada",
      email: "ada@example.com",
      extensions: {},
    });

    assert.deepStrictEqual(model.license, {
      name: "MIT",
      url: "https://example.com/license",
      extensions: {},
    });

    assert.deepStrictEqual(model.infoExtensions, { "x-internal": true });
    assert.deepStrictEqual(model.extensions, { "x-root": 1 });
    assert.deepStrictEqual(model.externalDocs, { url: "https://example.com/docs", extensions: {} });

    assert.deepStrictEqual(model.servers, [
      {
        id: "#/servers/0",
        url: "https://example.com/{version}",
        description: "Production",
        variables: { version: { default: "v1", enum: ["v1", "v2"], extensions: {} } },
        extensions: {},
      },
    ]);

    assert.deepStrictEqual(model.tags, [
      { id: "#/tags/0", name: "pets", description: "Pet operations", extensions: {} },
    ]);

    assert.deepStrictEqual(model.securitySchemes.bearer, {
      id: "#/components/securitySchemes/bearer",
      key: "bearer",
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
      extensions: {},
    });

    assert.strictEqual(model.securitySchemes.mtls?.description, "Client cert");
    assert.strictEqual(model.securitySchemes.oidc?.type, "openIdConnect");
    assert.strictEqual(model.securitySchemes.broken, undefined);

    assert.deepStrictEqual(
      model.security.map((requirement) =>
        requirement.map((use) => [use.scheme.key, use.scopes] as const),
      ),
      [[["apiKey", []]], [["oauth", ["read"]]]],
    );
  });
});

describe("decode operations", () => {
  const model = decodeModel({
    openapi: "3.1.0",
    info,
    tags: [{ name: "pets", description: "Pet operations" }],
    security: [{ apiKey: [] }],
    servers: [{ url: "https://example.com" }],
    components: {
      securitySchemes: {
        apiKey: { type: "apiKey", in: "header", name: "X-Key" },
        bearer: { type: "http", scheme: "bearer" },
      },
      parameters: {
        Id: { name: "id", in: "path", schema: { type: "string" } },
        Limit: { name: "limit", in: "query", schema: { type: "integer" } },
      },
      requestBodies: {
        Pet: { required: true, content: { "application/json": { schema: { type: "object" } } } },
      },
      responses: {
        NotFound: {
          description: "missing",
          headers: { "X-Rate": { $ref: "#/components/headers/Rate" } },
        },
      },
      headers: { Rate: { required: true, schema: { type: "integer" } } },
    },
    paths: {
      "/pets/{id}": {
        servers: [{ url: "https://pets.example.com" }],
        parameters: [
          { $ref: "#/components/parameters/Id" },
          { name: "limit", in: "query", schema: { type: "number" } },
          { $ref: "#/components/parameters/Missing" },
        ],
        get: {
          operationId: "getPet",
          summary: "Get a pet",
          deprecated: true,
          tags: ["pets", "other"],
          parameters: [
            { $ref: "#/components/parameters/Limit" },
            { name: "X-Trace", in: "header" },
          ],
          responses: {
            "200": {
              description: "ok",
              content: { "application/json": { schema: { type: "string" }, example: "Fido" } },
            },
            default: { description: "error" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
          callbacks: {
            onPet: {
              "{$request.body#/url}": { post: { responses: { "204": { description: "ok" } } } },
            },
          },
        },
        put: {
          security: [{ bearer: [] }],
          servers: [{ url: "https://put.example.com" }],
          requestBody: { $ref: "#/components/requestBodies/Pet" },
          responses: { "204": { description: "ok" } },
        },
        delete: { security: [], responses: { "204": { description: "ok" } } },
      },
      "x-ignored": { get: {} },
    },
  });

  const [get, put, remove] = model.operations;

  it("lists operations in path and method order", () => {
    assert.deepStrictEqual(
      model.operations.map((operation) => [operation.method, operation.path, operation.id]),
      [
        ["GET", "/pets/{id}", "#/paths/~1pets~1{id}/get"],
        ["PUT", "/pets/{id}", "#/paths/~1pets~1{id}/put"],
        ["DELETE", "/pets/{id}", "#/paths/~1pets~1{id}/delete"],
      ],
    );

    assert.deepStrictEqual(Object.keys(model.paths), ["/pets/{id}"]);
    assert.deepStrictEqual(model.paths["/pets/{id}"]?.operations[0], get);
  });

  it("reads operation metadata and resolves tags", () => {
    assert.strictEqual(get?.operationId, "getPet");
    assert.strictEqual(get?.summary, "Get a pet");
    assert.strictEqual(get?.deprecated, true);

    assert.deepStrictEqual(get?.tags, [
      { id: "#/tags/0", name: "pets", description: "Pet operations", extensions: {} },
      { id: "#/paths/~1pets~1{id}/get/tags/1", name: "other", extensions: {} },
    ]);
  });

  it("merges path-level parameters into the request", () => {
    const request = get?.request;

    assert.deepStrictEqual(request?.path, [
      {
        id: "#/components/parameters/Id",
        reference: { $ref: "#/components/parameters/Id" },
        name: "id",
        in: "path",
        style: "simple",
        required: true,
        deprecated: false,
        schema: { type: "string" },
        contents: [],
        examples: [],
        extensions: {},
      },
    ]);

    assert.strictEqual(request?.query.length, 1);
    assert.strictEqual(request?.query[0]?.reference?.$ref, "#/components/parameters/Limit");
    assert.strictEqual(request?.query[0]?.style, "form");
    assert.strictEqual(request?.headers[0]?.name, "X-Trace");
    assert.deepStrictEqual(request?.unknown, [{ $ref: "#/components/parameters/Missing" }]);
    assert.strictEqual(model.paths["/pets/{id}"]?.parameters.length, 2);
  });

  it("keeps responses in key order with default and resolved refs", () => {
    assert.deepStrictEqual(
      get?.responses.map((response) => [
        response.code,
        response.description,
        response.reference?.$ref,
      ]),
      [
        ["200", "ok", undefined],
        ["404", "missing", "#/components/responses/NotFound"],
        ["default", "error", undefined],
      ],
    );

    assert.deepStrictEqual(get?.responses[0]?.contents[0]?.examples, [
      {
        id: "#/paths/~1pets~1{id}/get/responses/200/content/application~1json/example",
        key: "default",
        value: "Fido",
        extensions: {},
      },
    ]);

    const header = get?.responses[1]?.headers[0];
    assert.strictEqual(header?.name, "X-Rate");
    assert.strictEqual(header?.reference?.$ref, "#/components/headers/Rate");
    assert.strictEqual(header?.required, true);
    assert.strictEqual(header?.id, "#/components/headers/Rate");
  });

  it("resolves request bodies and keeps their $ref", () => {
    assert.strictEqual(put?.request.body?.reference?.$ref, "#/components/requestBodies/Pet");
    assert.strictEqual(put?.request.body?.required, true);
    assert.strictEqual(put?.request.body?.contents[0]?.mediaType, "application/json");
  });

  it("inherits servers and security", () => {
    assert.deepStrictEqual(
      get?.servers.map((server) => server.url),
      ["https://pets.example.com"],
    );

    assert.deepStrictEqual(
      put?.servers.map((server) => server.url),
      ["https://put.example.com"],
    );

    assert.strictEqual(get?.securityDeclaration, "inheritedFromService");
    assert.strictEqual(put?.securityDeclaration, "declared");
    assert.strictEqual(remove?.securityDeclaration, "none");

    assert.deepStrictEqual(
      put?.security.map((requirement) => requirement.map((use) => use.scheme.key)),
      [["bearer"]],
    );

    assert.deepStrictEqual(remove?.security, []);
  });

  it("flattens callbacks into keyed operations", () => {
    assert.deepStrictEqual(
      get?.callbacks.map((callback) => [callback.key, callback.method, callback.path]),
      [["onPet", "POST", "{$request.body#/url}"]],
    );
  });
});

describe("decode components and path items", () => {
  it("keeps components by name and resolves aliases", () => {
    const model = decodeModel({
      openapi: "3.1.0",
      info,
      components: {
        schemas: { Pet: { type: "object" }, Flag: true },
        responses: {
          Error: { description: "nope" },
          Alias: { $ref: "#/components/responses/Error" },
        },
        requestBodies: { Pet: { required: true, content: {} } },
        headers: { Rate: { schema: { type: "integer" } } },
        examples: { Fido: { summary: "A dog", value: { name: "Fido" } } },
        links: { Next: { operationId: "getPet" } },
        callbacks: { onPet: { "{$url}": { post: { responses: {} } } } },
        pathItems: { Health: { get: { responses: { "204": { description: "ok" } } } } },
      },
      webhooks: { newPet: { post: { operationId: "newPet", responses: {} } } },
      $defs: { Name: { type: "string" } },
    });

    assert.deepStrictEqual(model.components.schemas, { Pet: { type: "object" }, Flag: true });
    assert.deepStrictEqual(model.$defs, { Name: { type: "string" } });

    assert.deepStrictEqual(model.components.responses.Error, {
      id: "#/components/responses/Error",
      description: "nope",
      headers: [],
      contents: [],
      links: [],
      extensions: {},
    });

    assert.strictEqual(
      model.components.responses.Alias?.reference?.$ref,
      "#/components/responses/Error",
    );

    assert.strictEqual(model.components.responses.Alias?.id, "#/components/responses/Error");
    assert.strictEqual(model.components.requestBodies.Pet?.required, true);
    assert.strictEqual(model.components.headers.Rate?.name, "Rate");
    assert.strictEqual(model.components.examples.Fido?.key, "Fido");
    assert.deepStrictEqual(model.components.examples.Fido?.value, { name: "Fido" });
    assert.strictEqual(model.components.links.Next?.operationId, "getPet");
    assert.strictEqual(model.components.callbacks.onPet?.[0]?.path, "{$url}");
    assert.strictEqual(model.components.pathItems.Health?.operations[0]?.path, "Health");
    assert.strictEqual(model.webhooks.newPet?.operations[0]?.operationId, "newPet");
    assert.strictEqual(model.operations.length, 0);
  });

  it("keeps the reference of path items and inlines #/paths refs", () => {
    const model = decodeModel({
      openapi: "3.1.0",
      info,
      components: {
        pathItems: { Health: { summary: "Health", get: { operationId: "health", responses: {} } } },
      },
      paths: {
        "/health": { $ref: "#/components/pathItems/Health" },
        "/foo bar": { get: { operationId: "spaced", responses: {} } },
        "/alias": { $ref: "#/paths/~1foo bar" },
        "/missing": { $ref: "#/components/pathItems/Missing" },
      },
    });

    assert.strictEqual(model.paths["/health"]?.reference?.$ref, "#/components/pathItems/Health");
    assert.strictEqual(model.paths["/health"]?.summary, "Health");
    assert.strictEqual(model.paths["/health"]?.operations[0]?.path, "/health");
    assert.strictEqual(model.paths["/alias"]?.reference?.$ref, undefined);
    assert.strictEqual(model.paths["/alias"]?.operations[0]?.operationId, "spaced");
    assert.strictEqual(model.paths["/missing"]?.reference?.$ref, "#/components/pathItems/Missing");
    assert.deepStrictEqual(model.paths["/missing"]?.operations, []);
    assert.strictEqual(model.components.pathItems.Health?.reference?.$ref, undefined);
  });

  it("resolves percent-encoded JSON Pointer refs", () => {
    const model = decodeModel({
      openapi: "3.1.0",
      info,
      components: { responses: { café: { description: "ok" } } },
      paths: {
        "/pets": { get: { responses: { "200": { $ref: "#/components/responses/caf%C3%A9" } } } },
      },
    });

    assert.strictEqual(model.operations[0]?.responses[0]?.description, "ok");
  });
});

describe("decode references", () => {
  it("keeps the Reference Object's own summary and description", () => {
    const model = decodeModel({
      openapi: "3.1.0",
      info,
      components: { parameters: { Id: { name: "id", in: "query", description: "An id" } } },
      paths: {
        "/pets": {
          get: {
            parameters: [{ $ref: "#/components/parameters/Id", description: "The pet's id" }],
            responses: {},
          },
        },
      },
    });

    const parameter = model.operations[0]?.request.query[0];
    assert.strictEqual(parameter?.description, "An id");

    assert.deepStrictEqual(parameter?.reference, {
      $ref: "#/components/parameters/Id",
      description: "The pet's id",
    });
  });
});

describe("decode schemas", () => {
  const schemaOf = (schema: unknown) =>
    decodeModel({ openapi: "3.1.0", info, components: { schemas: { S: schema } } }).components
      .schemas.S;

  it("keeps a bundled schema as written, unknown keywords included", () => {
    const schema = {
      type: ["object", "null"],
      required: ["a"],
      properties: {
        a: { type: "string", examples: [1] },
        b: { prefixItems: [{ type: "string" }] },
      },
      additionalProperties: false,
      "x-extra": { kept: true },
      discriminator: { propertyName: "kind", mapping: { a: "#/components/schemas/A" } },
      example: { a: "deprecated, but OpenAPI 3.1 vocabulary" },
    };

    assert.deepStrictEqual(schemaOf(schema), schema);
    assert.strictEqual(schemaOf(true), true);
  });

  it("fails with InvalidSchema for a schema that is not an object or a boolean", () => {
    const error = decodeError({ openapi: "3.1.0", info, components: { schemas: { S: "string" } } });
    assert.ok(error instanceof InvalidSchema);
    assert.ok(error.message.startsWith("#/components/schemas/S: "));

    const list = decodeError({ openapi: "3.1.0", info, components: { schemas: { S: [] } } });
    assert.ok(list instanceof InvalidSchema);
  });

  it("trusts the keywords of a bundled schema", () => {
    const schema = { type: "object", properties: { a: "string" }, required: true };
    assert.deepStrictEqual(schemaOf(schema), schema);
  });
});

describe("ParsedService schema", () => {
  it("validates a model as a Standard Schema", () => {
    const standard = Schema.toStandardSchemaV1(ParsedService);

    const model = decodeModel({
      openapi: "3.1.0",
      info,
      paths: { "/pets": { get: { responses: {} } } },
    });

    assert.deepStrictEqual(standard["~standard"].validate(model), { value: model });

    const result = standard["~standard"].validate({ ...model, operations: [{ method: "FETCH" }] });
    assert.ok("issues" in result && result.issues !== undefined && result.issues.length > 0);
  });
});
