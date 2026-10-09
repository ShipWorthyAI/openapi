import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { transformSchema } from "../../src/transforms/schema.ts";
import { document, print } from "../helpers.ts";

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
        yield* schemaType({
          type: "array",
          prefixItems: [{ type: "string" }, { type: "number" }],
          minItems: 2,
          maxItems: 2,
        }),
      ).toBe("[\n  string,\n  number\n]");
    }),
  );

  it.effect("uses required lists rather than defaults to decide property optionality", () =>
    Effect.gen(function* () {
      const properties = {
        count: { type: "integer", default: 0 },
        label: { type: ["string", "null"], default: null },
        enabled: { type: "boolean", default: false },
      };

      yield* Effect.forEach(
        [
          { type: "object", properties },
          { type: "object", properties, required: [] },
        ],
        Effect.fnUntraced(function* (schema) {
          const printed = yield* schemaType(schema);
          expect(printed).toContain("count?: number;");
          expect(printed).toContain("label?: string | null;");
          expect(printed).toContain("enabled?: boolean;");
        }),
        { discard: true },
      );

      const printed = yield* schemaType({
        type: "object",
        properties,
        required: ["count", "label"],
      });

      expect(printed).toContain("count: number;");
      expect(printed).toContain("label: string | null;");
      expect(printed).toContain("enabled?: boolean;");
    }),
  );

  it.effect("uses explicit additionalProperties for populated and empty objects", () =>
    Effect.gen(function* () {
      expect(yield* schemaType({ type: "object" })).toBe("Record<string, never>");

      expect(yield* schemaType({ type: "object", additionalProperties: false })).toBe(
        "Record<string, never>",
      );

      expect(yield* schemaType({ type: "object", additionalProperties: true })).toContain(
        "[key: string]: unknown;",
      );

      expect(
        yield* schemaType({
          type: "object",
          properties: { a: { type: "string" } },
          additionalProperties: true,
        }),
      ).toContain("[key: string]: unknown;");

      expect(
        yield* schemaType({ type: "object", properties: { a: { type: "string" } } }),
      ).not.toContain("[key: string]");
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

  it.effect("infers tuple lengths by default and allows disabling length inference", () =>
    Effect.gen(function* () {
      const schema = { type: "array", items: { type: "string" }, minItems: 2, maxItems: 3 };

      expect(yield* schemaType(schema)).toBe(
        "[\n  string,\n  string\n] | [\n  string,\n  string,\n  string\n]",
      );

      expect(yield* schemaType(schema, { arrayLength: false })).toBe("string[]");

      expect(yield* schemaType({ ...schema, maxItems: undefined })).toBe(
        "[\n  string,\n  string,\n  ...string[]\n]",
      );

      expect(yield* schemaType({ ...schema, minItems: 0, maxItems: 0 })).toBe("[\n]");
      expect(yield* schemaType({ ...schema, maxItems: 20 })).toBe("string[]");
    }),
  );

  it.effect("keeps nested arrays as tuple elements when inferring length", () =>
    Effect.gen(function* () {
      const schema = {
        type: "array",
        items: { type: "array", items: { type: "string" } },
        minItems: 2,
        maxItems: 2,
      };

      expect(yield* schemaType(schema)).toBe("[\n  string[],\n  string[]\n]");
      expect(yield* schemaType(schema, { arrayLength: false })).toBe("string[][]");
    }),
  );
});
