import { decode } from "@shipworthy/openapi-transformer";
import { Effect } from "effect";
import { expect, it } from "vitest";
import { tanstackQuery } from "../src/generator.ts";

it("omits empty case-mapping descriptors from generated clients", () => {
  const model = Effect.runSync(
    decode({
      openapi: "3.1.0",
      info: { title: "Money", version: "1" },
      paths: {
        "/money": {
          get: {
            operationId: "getMoney",
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Money" },
                  },
                },
              },
              "204": { description: "Empty" },
            },
          },
        },
      },
      components: {
        schemas: {
          Money: {
            type: "object",
            properties: {
              cash_back_percent: {
                oneOf: [{ type: "null" }, { type: "integer" }],
              },
              email: { type: "string" },
              reset: { $ref: "#/components/schemas/Reset" },
            },
          },
          Reset: { type: "object" },
        },
      },
    }),
  );

  const generated = tanstackQuery.generate(model, { camelCase: true });

  const source = Effect.runSync(Effect.isEffect(generated) ? generated : Effect.succeed(generated));

  expect(source).toContain('"cash_back_percent"');
  expect(source).toContain('"name": "cashBackPercent"');
  expect(source).not.toContain('"schema": {}');
  expect(source).not.toContain('"variants": [');
  expect(source).not.toContain('"requestBodies": {}');
  expect(source).not.toContain('"#/components/schemas/Reset": {}');
  expect(source).not.toContain('"204": {}');
});
