import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { transformSchema } from "../../src/transforms/schema.js";
import { document, print } from "../helpers.js";

/** Print the type of `schema`, declared as component `S`. */
function schemaType(schema: unknown, options?: Record<string, unknown>) {
  const model = document({ components: { schemas: { S: schema } } });

  return print(
    model,
    transformSchema(model.components.schemas.S, "#/components/schemas/S"),
    options,
  );
}

describe("transformSchema", () => {
  it.effect("prints primitives, booleans, and refs", () =>
    Effect.gen(function* () {
      expect(yield* schemaType({ type: "string" })).toBe("string");
      expect(yield* schemaType({ type: "integer" })).toBe("number");
      expect(yield* schemaType({ type: "null" })).toBe("null");
      expect(yield* schemaType(true)).toBe("unknown");
      expect(yield* schemaType(false)).toBe("never");

      expect(yield* schemaType({ $ref: "#/components/schemas/Pet" })).toBe(
        'components["schemas"]["Pet"]',
      );
    }),
  );

  it.effect("prints a list of types as a union", () =>
    Effect.gen(function* () {
      expect(yield* schemaType({ type: ["string", "null"] })).toBe("string | null");

      expect(yield* schemaType({ type: ["string", "null"], enum: ["a", "b", null] })).toBe(
        '"a" | "b" | null',
      );
    }),
  );

  it.effect("prints const and enum as literals", () =>
    Effect.gen(function* () {
      expect(yield* schemaType({ const: "fixed" })).toBe('"fixed"');
      expect(yield* schemaType({ type: "string", enum: ["red", "green"] })).toBe('"red" | "green"');
    }),
  );

  it.effect("prints objects with required, optional, and documented properties", () =>
    Effect.gen(function* () {
      expect(
        yield* schemaType({
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", description: "The id", readOnly: true },
            tags: { type: "array", items: { type: "string" } },
          },
          additionalProperties: { type: "number" },
        }),
      ).toMatchInlineSnapshot(`
        "{
          /** @description The id */
          readonly id: string;
          tags?: string[];
        } & {
          [key: string]: number;
        }"
      `);
    }),
  );

  it.effect("prints tuples from prefixItems", () =>
    Effect.gen(function* () {
      expect(
        yield* schemaType({ type: "array", prefixItems: [{ type: "string" }, { type: "number" }] }),
      ).toBe("[\n  string,\n  number\n]");
    }),
  );

  it.effect("prints allOf as an intersection and anyOf/oneOf as unions", () =>
    Effect.gen(function* () {
      expect(
        yield* schemaType({
          allOf: [{ $ref: "#/components/schemas/A" }, { $ref: "#/components/schemas/B" }],
        }),
      ).toBe('components["schemas"]["A"] & components["schemas"]["B"]');

      expect(
        yield* schemaType({
          anyOf: [{ $ref: "#/components/schemas/A" }, { type: "null" }],
        }),
      ).toBe('components["schemas"]["A"] | null');

      expect(yield* schemaType({ oneOf: [{ type: "string" }, { type: "number" }] })).toBe(
        "string | number",
      );
    }),
  );

  it.effect("applies allOf/anyOf once when type lists several types", () =>
    Effect.gen(function* () {
      expect(
        yield* schemaType({
          type: ["object", "null"],
          anyOf: [{ $ref: "#/components/schemas/A" }, { $ref: "#/components/schemas/B" }],
        }),
      ).toBe('(components["schemas"]["A"] | components["schemas"]["B"]) | null');
    }),
  );

  it.effect("follows options", () =>
    Effect.gen(function* () {
      const object = { type: "object", properties: { a: { type: "string" } } };

      expect(yield* schemaType(object, { immutable: true })).toMatchInlineSnapshot(`
        "{
          readonly a?: string;
        }"
      `);

      expect(yield* schemaType(object, { propertiesRequiredByDefault: true }))
        .toMatchInlineSnapshot(`
        "{
          a: string;
        }"
      `);

      expect(yield* schemaType(object, { additionalProperties: true })).toMatchInlineSnapshot(`
        "{
          a?: string;
        } & {
          [key: string]: unknown;
        }"
      `);
    }),
  );
});
