import { it } from "@effect/vitest";
import { Effect } from "effect";
import { openapiTS } from "./openapi-ts.js";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

describe("Invalid schemas", () => {
  it.effect("Swagger 2.0 throws", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(openapiTS({ swagger: "2.0" }));

      expect(messageOf(error)).toContain(
        "Unsupported Swagger version: 2.x. Use OpenAPI 3.x instead.",
      );
    }),
  );

  it.effect("OpenAPI < 3 throws", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        openapiTS({
          openapi: "2.0",
          info: { title: "Test", version: "1.0" },
        }),
      );

      expect(messageOf(error)).toContain("Unsupported OpenAPI version: 2.0");
    }),
  );

  it.effect("Other missing required fields", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(openapiTS({}));
      expect(messageOf(error)).toContain("Unsupported schema format, expected `openapi: 3.x`");
    }),
  );

  it.effect("Unresolved $ref error messages", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        openapiTS({
          openapi: "3.1",
          info: { title: "test", version: "1.0" },
          components: {
            schemas: {
              Pet: {
                type: "object",
                properties: {
                  category: { $ref: "#/components/schemas/NonExistingSchema" },
                  type: { $ref: "#/components/schemas/AnotherSchema" },
                },
              },
            },
          },
        }),
      );

      expect(messageOf(error)).toMatch(/NonExistingSchema/);
    }),
  );
});
