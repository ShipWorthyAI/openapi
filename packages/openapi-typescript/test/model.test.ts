import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { buildCaseMapping } from "../src/generation/casing/index.ts";
import { typescript } from "../src/index.ts";
import { document } from "./helpers.ts";

/** snake_case fields, a mapped `oneOf` discriminator over `allOf` branches, and a JSON body. */
const pets = {
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

it.effect("does not modify the model it is given", () =>
  Effect.gen(function* () {
    const model = document(pets);
    const snapshot = structuredClone(model);

    yield* Effect.forEach(
      [false, true],
      (camelCase) => {
        const generated = typescript.generate(model, { camelCase, silent: true });
        return Effect.isEffect(generated) ? generated : Effect.succeed(generated);
      },
      { discard: true },
    );

    expect(model).toEqual(snapshot);
  }),
);

it.effect("buildCaseMapping does not modify the model it is given", () =>
  Effect.gen(function* () {
    const model = document(pets);
    const snapshot = structuredClone(model);
    yield* buildCaseMapping(model);
    expect(model).toEqual(snapshot);
  }),
);
