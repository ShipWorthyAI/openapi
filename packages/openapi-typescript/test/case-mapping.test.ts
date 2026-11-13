import { decode } from "@shipworthy/openapi-transformer";
import { Effect } from "effect";
import { expect, it } from "vitest";
import { buildCaseMapping, CaseMappingGenerationError } from "../src/generation/casing/index.ts";

it("compiles schema-based case mappings independently of TanStack Query", () => {
  const model = Effect.runSync(
    decode({
      openapi: "3.1.0",
      info: { title: "Hotels", version: "1" },
      paths: {
        "/hotels": {
          get: {
            operationId: "getHotels",
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: { hotel_id: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
  );

  const mapping = Effect.runSync(buildCaseMapping(model));

  expect(mapping.operations?.["GET /hotels"]?.responses?.["200"]?.["application/json"]).toEqual({
    properties: { hotel_id: { name: "hotelId" } },
  });
});

it("exposes typed mapping generation failures", () => {
  const model = Effect.runSync(
    decode({
      openapi: "3.1.0",
      info: { title: "Hotels", version: "1" },
      paths: {
        "/hotels": {
          get: {
            operationId: "getHotels",
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        hotel_id: { type: "string" },
                        hotelId: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
  );

  const error = Effect.runSync(Effect.flip(buildCaseMapping(model)));
  expect(error).toBeInstanceOf(CaseMappingGenerationError);
  expect(error.message).toContain("hotel_id and hotelId both become hotelId");
});
