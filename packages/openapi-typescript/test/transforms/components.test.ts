import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { transformComponents } from "../../src/transforms/components.js";
import { document, print } from "../helpers.js";

const components = {
  schemas: {
    Pet: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
    Color: { type: "string", enum: ["red", "green"] },
  },
  responses: {
    NotFound: { description: "Not found" },
    Missing: { $ref: "#/components/responses/NotFound" },
  },
  parameters: {
    Limit: { name: "limit", in: "query", description: "Page size", schema: { type: "integer" } },
  },
  requestBodies: {
    Pet: { content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } },
  },
  headers: { Rate: { schema: { type: "integer" } } },
};

describe("transformComponents", () => {
  it.effect("prints each kind of component, printing aliases as references", () =>
    Effect.gen(function* () {
      const model = document({ components });

      expect(yield* print(model, transformComponents(model.components))).toMatchInlineSnapshot(`
        "{
          schemas: {
            Pet: {
              name: string;
            };
            /** @enum {string} */
            Color: "red" | "green";
          };
          responses: {
            /** @description Not found */
            NotFound: {
              headers: {
                [name: string]: unknown;
              };
              content?: never;
            };
            Missing: components["responses"]["NotFound"];
          };
          parameters: {
            /** @description Page size */
            Limit: number;
          };
          requestBodies: {
            Pet: {
              content: {
                "application/json": components["schemas"]["Pet"];
              };
            };
          };
          headers: {
            Rate: number;
          };
          pathItems: never;
        }"
      `);
    }),
  );

  it.effect("adds root type aliases with rootTypes", () =>
    Effect.gen(function* () {
      const model = document({ components });

      const printed = yield* print(model, transformComponents(model.components), {
        rootTypes: true,
      });

      expect(printed).toContain("export type SchemaPet = components['schemas']['Pet'];");

      expect(printed).toContain(
        "export type ResponseNotFound = components['responses']['NotFound'];",
      );

      expect(printed).toContain("export type ParameterLimit = components['parameters']['Limit'];");
    }),
  );
});
