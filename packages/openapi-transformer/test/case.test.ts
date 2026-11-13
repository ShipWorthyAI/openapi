import { describe, it } from "@effect/vitest";
import { strict as assert } from "node:assert";
import { camelCaseSchema, type ParsedSchema } from "../src/index.ts";

const text = { type: "string" };

describe("camelCaseSchema", () => {
  it("renames properties, required, dependentRequired, dependentSchemas, and the discriminator", () => {
    assert.deepStrictEqual(
      camelCaseSchema({
        type: "object",
        required: ["first_name", "id", 3],
        properties: { first_name: text, id: text },
        dependentRequired: { credit_card: ["billing_address", "zip"] },
        dependentSchemas: { shipping_address: { required: ["postal_code"] } },
        discriminator: {
          propertyName: "pet_type",
          mapping: { house_cat: "#/components/schemas/house_cat" },
        },
      }),
      {
        type: "object",
        required: ["firstName", "id", 3],
        properties: { firstName: text, id: text },
        dependentRequired: { creditCard: ["billingAddress", "zip"] },
        dependentSchemas: { shippingAddress: { required: ["postalCode"] } },
        discriminator: {
          propertyName: "petType",
          mapping: { house_cat: "#/components/schemas/house_cat" },
        },
      },
    );
  });

  it("recurses into every subschema position", () => {
    const inner = { properties: { inner_name: text }, required: ["inner_name"] };
    const renamed = { properties: { innerName: text }, required: ["innerName"] };

    const positions = [
      "additionalProperties",
      "unevaluatedProperties",
      "items",
      "unevaluatedItems",
      "contains",
      "propertyNames",
      "not",
      "if",
      "then",
      "else",
    ];

    for (const keyword of positions) {
      assert.deepStrictEqual(
        camelCaseSchema({ [keyword]: inner }),
        { [keyword]: renamed },
        keyword,
      );
    }

    for (const keyword of ["allOf", "anyOf", "oneOf", "prefixItems"]) {
      assert.deepStrictEqual(
        camelCaseSchema({ [keyword]: [inner, true] }),
        { [keyword]: [renamed, true] },
        keyword,
      );
    }

    assert.deepStrictEqual(
      camelCaseSchema({
        properties: { outer_name: inner },
        patternProperties: { "^snake_key$": inner },
        dependentSchemas: { trigger_name: inner },
        $defs: { nested_def: inner },
      }),
      {
        properties: { outerName: renamed },
        patternProperties: { "^snake_key$": renamed },
        dependentSchemas: { triggerName: renamed },
        $defs: { nested_def: renamed },
      },
    );
  });

  it("leaves values, references, extensions, and malformed subschemas untouched", () => {
    const schema = {
      $ref: "#/components/schemas/snake_case",
      enum: ["in_progress", { snake_key: 1 }],
      const: "snake_value",
      default: { snake_key: "snake_value" },
      example: { snake_key: 1 },
      examples: [{ snake_key: 1 }],
      "x-snake_case": { properties: { snake_key: text } },
      title: "snake_title",
      items: [{ properties: { snake_key: text } }],
      not: "snake_value",
      allOf: "snake_value",
      required: "snake_value",
      properties: ["snake_value"],
      discriminator: { propertyName: 1 },
    };

    assert.deepStrictEqual(camelCaseSchema(schema), schema);
  });

  it("keeps names that are not lower snake_case", () => {
    const names = [
      "already_Camel",
      "_private",
      "UPPER_CASE",
      "a",
      "trailing_",
      "a__b",
      "camelCase",
    ];

    const schema = {
      required: names,
      properties: Object.fromEntries(names.map((name) => [name, text])),
    };

    assert.deepStrictEqual(camelCaseSchema(schema), schema);
  });

  it("converts digits and multiple segments the same way as propertyName", () => {
    assert.deepStrictEqual(camelCaseSchema({ properties: { address_line_2: text, v2_id: text } }), {
      properties: { addressLine2: text, v2Id: text },
    });
  });

  it("returns booleans unchanged", () => {
    assert.strictEqual(camelCaseSchema(true), true);
    assert.strictEqual(camelCaseSchema(false), false);

    assert.deepStrictEqual(camelCaseSchema({ properties: { snake_key: false } }), {
      properties: { snakeKey: false },
    });
  });

  it("keeps a __proto__ property as an own key", () => {
    const schema: ParsedSchema = JSON.parse('{"properties":{"__proto__":{"type":"string"}}}');
    const result = camelCaseSchema(schema);

    assert.ok(typeof result === "object");
    assert.ok(typeof result.properties === "object" && result.properties !== null);
    assert.ok(Object.hasOwn(result.properties, "__proto__"));
  });

  it("does not modify its input", () => {
    const schema: ParsedSchema = {
      type: "object",
      required: ["user_id"],
      properties: {
        user_id: text,
        nested_list: { type: "array", items: { properties: { item_name: text } } },
      },
      allOf: [{ properties: { other_name: text } }],
      discriminator: { propertyName: "kind_name" },
      dependentRequired: { user_id: ["nested_list"] },
    };

    const before = structuredClone(schema);
    const result = camelCaseSchema(schema);

    assert.deepStrictEqual(schema, before);
    assert.notStrictEqual(result, schema);
  });
});
