import { Effect, FileSystem, Layer, Path } from "effect";
import { describe, expect, it } from "vitest";
import { loadDocument, parseModel, type LoadError } from "../src/index.js";

const layer = Layer.mergeAll(FileSystem.layerNoop({}), Path.layer);

function run(source: unknown) {
  return Effect.runPromise(
    loadDocument(source).pipe(Effect.provide(layer)) as Effect.Effect<unknown, LoadError, never>,
  );
}

describe("loadDocument", () => {
  it("rejects an empty source", async () => {
    await expect(run("")).rejects.toThrow("Empty schema. Please specify a URL or file path");
    await expect(run(undefined)).rejects.toThrow("Empty schema. Please specify a URL or file path");
  });

  it("rejects Swagger 2", async () => {
    await expect(run({ swagger: "2.0" })).rejects.toThrow(
      "Unsupported Swagger version: 2.x. Use OpenAPI 3.x instead.",
    );
  });

  it("rejects a missing openapi version", async () => {
    await expect(run({})).rejects.toThrow("Unsupported schema format, expected `openapi: 3.x`");
  });

  it("rejects OpenAPI 2", async () => {
    await expect(run({ openapi: "2.0", info: { title: "Test", version: "1.0" } })).rejects.toThrow(
      "Unsupported OpenAPI version: 2.0",
    );
  });
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
        schemas: { Pet: { type: "object", properties: { name: { type: "string" } } } },
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

    expect(model.openapi).toBe("3.1.0");
    expect(model.info.title).toBe("Pets");
    expect(model.tags).toEqual([{ name: "pets" }]);
    expect(model.securitySchemes.apiKey).toMatchObject({ type: "apiKey" });
    expect(model.components.schemas.Pet).toMatchObject({ type: "object" });
    expect(model.webhooks.newPet).toBeTypeOf("object");
    expect(model.$defs.Name).toEqual({ type: "string" });

    expect(model.operations).toEqual([
      expect.objectContaining({
        id: "getPet",
        operationId: "getPet",
        method: "GET",
        path: "/pets/{id}",
      }),
    ]);

    expect(model.operations[0]?.parameters.path).toEqual([
      expect.objectContaining({ name: "id", required: true }),
    ]);

    expect(model.operations[0]?.parameters.query).toEqual([
      expect.objectContaining({ name: "limit", schema: { type: "integer" } }),
    ]);

    expect(model.operations[0]?.responses[0]?.content["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/Pet",
    });
  });
});
