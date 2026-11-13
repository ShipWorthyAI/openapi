import { decode } from "@shipworthy/openapi-transformer";
import { Effect } from "effect";
import { expect, it } from "vitest";
import { tanstackQuery } from "../src/generator.ts";

/** snake_case fields, a mapped `oneOf` discriminator over `allOf` branches, and a JSON body. */
const pets = {
  openapi: "3.1.0",
  info: { title: "Pets", version: "1" },
  paths: {
    "/pets": {
      post: {
        operationId: "createPet",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } },
        },
        responses: {
          "200": {
            description: "OK",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        oneOf: [{ $ref: "#/components/schemas/Cat" }, { $ref: "#/components/schemas/Dog" }],
        discriminator: {
          propertyName: "pet_type",
          mapping: { cat: "#/components/schemas/Cat", dog: "#/components/schemas/Dog" },
        },
      },
      PetBase: {
        type: "object",
        required: ["pet_type"],
        properties: { pet_type: { type: "string" }, pet_name: { type: "string" } },
      },
      Cat: {
        allOf: [
          { $ref: "#/components/schemas/PetBase" },
          { type: "object", properties: { whisker_count: { type: "integer" } } },
        ],
      },
      Dog: {
        type: "object",
        required: ["pet_type"],
        properties: { pet_type: { type: "string" }, bark_volume: { type: "integer" } },
      },
    },
  },
};

it("does not modify the model it is given", async () => {
  const model = Effect.runSync(decode(pets));
  const snapshot = structuredClone(model);

  await Effect.runPromise(
    Effect.forEach(
      [false, true],
      (camelCase) => {
        const generated = tanstackQuery.generate(model, {
          name: "pets",
          prefix: "Pets",
          camelCase,
        });

        return Effect.isEffect(generated) ? generated : Effect.succeed(generated);
      },
      { discard: true },
    ),
  );

  expect(model).toEqual(snapshot);
});
