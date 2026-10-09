import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import ts from "#compiler";
import { transformOperation } from "../../src/transforms/operation.ts";
import { document, print } from "../helpers.ts";

const pet = { $ref: "#/components/schemas/Pet" };

/** Print the members of the first operation under `/pets/{id}`. */
function operationType(pathItem: Record<string, unknown>, options?: Record<string, unknown>) {
  const model = document({
    paths: { "/pets/{id}": pathItem },
    components: {
      parameters: { Limit: { name: "limit", in: "query", schema: { type: "integer" } } },
      requestBodies: { Pet: { required: true, content: { "application/json": { schema: pet } } } },
      responses: { NotFound: { description: "Not found" } },
      headers: { Rate: { schema: { type: "integer" } } },
    },
  });

  const operation = model.operations[0];
  if (!operation) throw new Error("no operation");

  return print(
    model,
    transformOperation(operation, "#/paths/~1pets~1{id}/get").pipe(
      Effect.map((members) => ts.factory.createTypeLiteralNode(members)),
    ),
    options,
  );
}

describe("transformOperation", () => {
  it.effect("groups parameters by location, with path-level parameters merged in", () =>
    Effect.gen(function* () {
      expect(
        yield* operationType({
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          get: {
            parameters: [
              { $ref: "#/components/parameters/Limit" },
              {
                name: "X-Trace",
                in: "header",
                required: true,
                description: "Trace id",
                schema: { type: "string" },
              },
            ],
          },
        }),
      ).toMatchInlineSnapshot(`
        "{
          parameters: {
            query?: {
              limit?: components["parameters"]["Limit"];
            };
            header: {
              /** @description Trace id */
              "X-Trace": string;
            };
            path: {
              id: string;
            };
            cookie?: never;
          };
          requestBody?: never;
          responses: never;
        }"
      `);
    }),
  );

  it.effect("prints request bodies, responses, and response headers", () =>
    Effect.gen(function* () {
      expect(
        yield* operationType({
          get: {
            requestBody: {
              description: "The pet",
              content: { "application/json": { schema: pet } },
            },
            responses: {
              "200": {
                description: "OK",
                headers: {
                  "X-Rate": { $ref: "#/components/headers/Rate" },
                  "X-Note": { schema: { type: "string" } },
                },
                content: { "application/json": { schema: pet } },
              },
              "404": { $ref: "#/components/responses/NotFound" },
              default: { description: "Error" },
            },
          },
        }),
      ).toMatchInlineSnapshot(`
        "{
          parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
          };
          /** @description The pet */
          requestBody?: {
            content: {
              "application/json": components["schemas"]["Pet"];
            };
          };
          responses: {
            /** @description OK */
            200: {
              headers: {
                "X-Rate": components["headers"]["Rate"];
                "X-Note"?: string;
                [name: string]: unknown;
              };
              content: {
                "application/json": components["schemas"]["Pet"];
              };
            };
            404: components["responses"]["NotFound"];
            /** @description Error */
            default: {
              headers: {
                [name: string]: unknown;
              };
              content?: never;
            };
          };
        }"
      `);
    }),
  );

  it.effect("prints a referenced request body", () =>
    Effect.gen(function* () {
      expect(
        yield* operationType({
          get: { requestBody: { $ref: "#/components/requestBodies/Pet" } },
        }),
      ).toContain('requestBody: components["requestBodies"]["Pet"];');
    }),
  );

  it.effect("does not infer undeclared parameters from the path template", () =>
    Effect.gen(function* () {
      const printed = yield* operationType({ get: {} });
      expect(printed).toContain("path?: never;");
      expect(printed).not.toContain("id: string;");
    }),
  );
});
