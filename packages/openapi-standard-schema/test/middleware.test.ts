import createClient from "@shipworthy/openapi-fetch";
import { ParsedServiceFromParsedOpenApi } from "@shipworthy/openapi-transformer";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { SchemaGenerationError, standardSchema } from "../src/index";

const exec = promisify(execFile);

const document = {
  openapi: "3.1.0",
  info: { title: "Items", version: "1" },
  paths: {
    "/items/{id}": {
      put: {
        operationId: "updateItem",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Item" } } },
        },
        responses: {
          "200": {
            description: "Updated",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Item" } } },
          },
          "204": { description: "Unchanged" },
          "4XX": {
            description: "Rejected",
            content: {
              "application/problem+json": {
                schema: {
                  type: "object",
                  required: ["title"],
                  properties: { title: { type: "string" } },
                },
              },
            },
          },
          default: {
            description: "Failed",
            content: {
              "text/plain": { schema: { type: "string" } },
              "*/*": {
                schema: {
                  type: "object",
                  required: ["error_code"],
                  properties: { error_code: { type: "integer" } },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Item: {
        type: "object",
        required: ["item_name"],
        properties: { item_name: { type: "string", minLength: 1 } },
      },
    },
  },
};

function sourceFor(input: unknown, options: Readonly<Record<string, unknown>>) {
  return Effect.gen(function* () {
    const model = yield* Schema.decodeUnknownEffect(ParsedServiceFromParsedOpenApi)(input);
    const generated = standardSchema.generate(model, options);
    return Effect.isEffect(generated) ? yield* generated : generated;
  });
}

/** The generated `OpenApiValidationError`, as the tests read it. */
interface ValidationError extends Error {
  readonly direction: "request" | "response";
  readonly method: string;
  readonly schemaPath: string;
  readonly status: number | undefined;
  readonly issues: readonly { readonly message: string }[];
}

interface Generated {
  readonly OpenApiValidationError: abstract new (...args: never[]) => ValidationError;
  readonly onRequestValidation: (options: {
    readonly request: Request;
    readonly schemaPath: string;
  }) => Promise<undefined>;
  readonly onResponseValidation: (options: {
    readonly request: Request;
    readonly response: Response;
    readonly schemaPath: string;
  }) => Promise<undefined>;
}

async function withModule<A>(
  source: string,
  use: (module: Generated, directory: string) => Promise<A>,
): Promise<A> {
  const directory = await mkdtemp(resolve(import.meta.dirname, ".generation-"));
  const file = resolve(directory, "standard-schema.ts");
  await writeFile(file, source);

  try {
    return await use((await import(pathToFileURL(file).href)) as Generated, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function json(status: number, body: unknown, contentType = "application/json") {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": contentType } });
}

/** A client whose fetch answers with `respond` and records the requests that reached it. */
function clientFor(module: Generated, respond: () => Response) {
  const sent: Request[] = [];

  const client = createClient({
    baseUrl: "https://api.test",
    fetch: async (request: Request) => {
      sent.push(request);
      return respond();
    },
  });

  client.use({ onRequest: module.onRequestValidation, onResponse: module.onResponseValidation });

  const put = (body: unknown) =>
    client.PUT("/items/{id}" as never, { params: { path: { id: "1" } }, body } as never);

  return { put, sent };
}

describe("validation middleware", () => {
  it.effect("is generated only when requested", () =>
    Effect.gen(function* () {
      const plain = yield* sourceFor(document, {});
      expect(plain).not.toMatch(/onRequestValidation|OpenApiValidationError/);

      const source = yield* sourceFor(document, { validationMiddleware: true });
      expect(source).toContain("export async function onRequestValidation(");
      expect(source).toContain("export async function onResponseValidation(");
      const table = source.slice(source.indexOf("const __openapiValidation"));
      // A body that only references a component reuses the component's export.
      expect(table.match(/"application\/json": Item,/g)).toHaveLength(2);
      // Only the inline 4XX and default response schemas get their own validators.
      expect(table.match(/Schema\.toStandardSchemaV1/g)).toHaveLength(2);
      expect(source).toContain('"4XX": {');
      expect(source).not.toContain('"text/plain"');
      expect(source).not.toContain("__wire_");
      expect(source).not.toContain("__openapiWireComponents");
    }),
  );

  it("validates JSON bodies through openapi-fetch", async () => {
    const source = await Effect.runPromise(sourceFor(document, { validationMiddleware: true }));

    await withModule(source, async (module) => {
      const { OpenApiValidationError } = module;
      const valid = clientFor(module, () => json(200, { item_name: "Lamp" }));
      expect((await valid.put({ item_name: "Lamp" })).data).toEqual({ item_name: "Lamp" });
      // The middleware reads a clone, so the request body still reaches fetch.
      expect(await valid.sent[0]?.json()).toEqual({ item_name: "Lamp" });

      const request = await valid.put({ item_name: "" }).catch((error: unknown) => error);
      expect(request).toBeInstanceOf(OpenApiValidationError);

      expect(request).toMatchObject({
        direction: "request",
        method: "PUT",
        schemaPath: "/items/{id}",
        status: undefined,
      });

      expect((request as ValidationError).message).toMatch(
        /^Invalid request body for PUT \/items\/\{id\}\n {2}- item_name: /,
      );

      expect(valid.sent).toHaveLength(1);

      const response = await clientFor(module, () => json(200, { name: "Lamp" }))
        .put({ item_name: "Lamp" })
        .catch((error: unknown) => error);

      expect(response).toBeInstanceOf(OpenApiValidationError);
      expect(response).toMatchObject({ direction: "response", status: 200 });

      const problem = (body: unknown) =>
        clientFor(module, () => json(404, body, "application/problem+json"));

      expect((await problem({ title: "Missing" }).put({ item_name: "Lamp" })).error).toEqual({
        title: "Missing",
      });

      await expect(problem({ detail: "Missing" }).put({ item_name: "Lamp" })).rejects.toMatchObject(
        { status: 404 },
      );

      // `default` documents `*/*`, which matches any JSON response.
      await expect(
        clientFor(module, () => json(500, { error_code: "E1" })).put({ item_name: "Lamp" }),
      ).rejects.toMatchObject({ status: 500 });

      await clientFor(module, () => new Response(null, { status: 204 })).put({
        item_name: "Lamp",
      });

      await clientFor(
        module,
        () => new Response("oops", { status: 500, headers: { "content-type": "text/plain" } }),
      ).put({ item_name: "Lamp" });
    });
  });

  it("checks the wire field names with camelCase", async () => {
    const source = await Effect.runPromise(
      sourceFor(document, { camelCase: true, validationMiddleware: true }),
    );

    expect(source).toContain('"itemName"');
    expect(source).toContain("const __wire_ItemSchema = ");

    // The wire Item validator is declared once and shared by the request and the 200 response.
    expect(source).toMatch(
      /const __openapiWireComponents = \{\n {2}"Item": Schema\.toStandardSchemaV1\(__wire_ItemSchema\),/,
    );

    expect(source.match(/__openapiWireComponents\.Item/g)).toHaveLength(2);

    await withModule(source, async (module) => {
      await clientFor(module, () => json(200, { item_name: "Lamp" })).put({ item_name: "Lamp" });

      await expect(
        clientFor(module, () => json(200, { item_name: "Lamp" })).put({ itemName: "Lamp" }),
      ).rejects.toMatchObject({ direction: "request" });

      await expect(
        clientFor(module, () => json(200, { itemName: "Lamp" })).put({ item_name: "Lamp" }),
      ).rejects.toMatchObject({ direction: "response" });
    });
  });

  it("type-checks as openapi-fetch middleware", async () => {
    const source = await Effect.runPromise(sourceFor(document, { validationMiddleware: true }));

    await withModule(source, async (_, directory) => {
      await writeFile(
        resolve(directory, "consumer.ts"),
        `
          import createClient from "@shipworthy/openapi-fetch";
          import {
            OpenApiValidationError,
            onRequestValidation,
            onResponseValidation,
          } from "./standard-schema";
          const client = createClient({ baseUrl: "https://api.test" });
          client.use({ onRequest: onRequestValidation, onResponse: onResponseValidation });
          const messages = (error: unknown): string[] =>
            error instanceof OpenApiValidationError ? error.issues.map((issue) => issue.message) : [];
          void messages;
        `,
      );

      await exec(process.execPath, [
        resolve(import.meta.dirname, "../../../node_modules/typescript/bin/tsc"),
        "--ignoreConfig",
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--target",
        "ES2022",
        "--module",
        "ESNext",
        "--moduleResolution",
        "bundler",
        // openapi-fetch resolves to its TypeScript source inside this workspace.
        "--allowImportingTsExtensions",
        resolve(directory, "consumer.ts"),
      ]);
    });
  }, 60_000);

  it.effect("emits only the middleware when no operation has a JSON body", () =>
    Effect.gen(function* () {
      const source = yield* sourceFor(
        { ...document, paths: {}, components: { schemas: {} } },
        { validationMiddleware: true },
      );

      expect(source).toContain("export async function onRequestValidation(");
      expect(source).toContain("const __openapiValidation: Partial<");
    }),
  );

  it.effect("rejects component names the middleware declares", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        sourceFor(
          {
            ...document,
            components: { schemas: { ...document.components.schemas, onRequestValidation: {} } },
          },
          { validationMiddleware: true },
        ),
      );

      expect(failure).toBeInstanceOf(SchemaGenerationError);

      expect(failure.message).toBe(
        "#/components/schemas/onRequestValidation: Cannot emit this name as a schema export",
      );
    }),
  );
});
