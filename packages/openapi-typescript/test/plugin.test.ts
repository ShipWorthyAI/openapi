import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import ts from "#compiler";
import { astToString, typescript } from "../src/index.ts";
import { document, generateTypes } from "./helpers.ts";

/** Run the plugin on a parsed model, the way the generator does. */
function run(model: ReturnType<typeof document>, options: Record<string, unknown> = {}) {
  const generated = typescript.generate(model, options);

  return (Effect.isEffect(generated) ? generated : Effect.succeed(generated)).pipe(
    Effect.map((nodes) => astToString(nodes as ts.Node[]).trim()),
  );
}

const petstore = {
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        responses: {
          "200": {
            description: "The pets",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/Pet" } },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
    },
  },
  $defs: { Name: { type: "string" } },
};

describe("typescript plugin", () => {
  it.effect("prints paths, webhooks, components, $defs, and operations", () =>
    Effect.gen(function* () {
      expect(yield* run(document(petstore))).toMatchInlineSnapshot(`
        "export interface paths {
          "/pets": {
            parameters: {
              query?: never;
              header?: never;
              path?: never;
              cookie?: never;
            };
            get: operations["listPets"];
            put?: never;
            post?: never;
            delete?: never;
            options?: never;
            head?: never;
            patch?: never;
            trace?: never;
          };
        }
        export type webhooks = Record<string, never>;
        export interface components {
          schemas: {
            Pet: {
              name: string;
            };
          };
          responses: never;
          parameters: never;
          requestBodies: never;
          headers: never;
          pathItems: never;
        }
        export interface $defs {
          Name: string;
        }
        export interface operations {
          listPets: {
            parameters: {
              query?: never;
              header?: never;
              path?: never;
              cookie?: never;
            };
            requestBody?: never;
            responses: {
              /** @description The pets */
              200: {
                headers: {
                  [name: string]: unknown;
                };
                content: {
                  "application/json": components["schemas"]["Pet"][];
                };
              };
            };
          };
        }
        export enum ApiPaths {
          listPets = "/pets"
        }"
      `);
    }),
  );

  it.effect("prints empty roots as records of never", () =>
    Effect.gen(function* () {
      expect(yield* run(document({}))).toMatchInlineSnapshot(`
        "export type paths = Record<string, never>;
        export type webhooks = Record<string, never>;
        export interface components {
          schemas: never;
          responses: never;
          parameters: never;
          requestBodies: never;
          headers: never;
          pathItems: never;
        }
        export type $defs = Record<string, never>;
        export type operations = Record<string, never>;
        export enum ApiPaths {
        }"
      `);
    }),
  );

  it.effect("exports type aliases with exportType and always includes ApiPaths", () =>
    Effect.gen(function* () {
      const printed = yield* run(document(petstore), { exportType: true });

      expect(printed).toContain("export type paths = {");
      expect(printed).toContain('listPets = "/pets"');
    }),
  );

  it.effect("rejects options of the wrong type", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(run(document({}), { arrayLength: "yes" }));
      expect(error._tag).toBe("TypegenError");
      expect(error.message).toContain("arrayLength");
    }),
  );

  it.effect("rejects unknown options", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(run(document({}), { unknownOption: true }));
      expect(error._tag).toBe("TypegenError");
      expect(error.message).toContain("unknownOption");
    }),
  );

  it.effect("narrows anyOf components with discriminator values", () =>
    Effect.gen(function* () {
      const printed = yield* run(
        document({
          components: {
            schemas: {
              Result: {
                anyOf: [
                  { $ref: "#/components/schemas/Good" },
                  { $ref: "#/components/schemas/Other" },
                ],
                discriminator: {
                  propertyName: "kind",
                  mapping: { good: "Good" },
                },
              },
              Good: { type: "object", properties: { value: { type: "integer" } } },
              Other: { type: "object", additionalProperties: true },
            },
          },
        }),
      );

      expect(printed).toContain('kind: "good";');
      expect(printed).toContain('kind: "Other";');
    }),
  );

  it.effect("combines discriminator values when unions share a component", () =>
    Effect.gen(function* () {
      const printed = yield* run(
        document({
          components: {
            schemas: {
              First: {
                oneOf: [{ $ref: "#/components/schemas/Shared" }],
                discriminator: {
                  propertyName: "kind",
                  mapping: { first: "#/components/schemas/Shared" },
                },
              },
              Second: {
                oneOf: [{ $ref: "#/components/schemas/Shared" }],
                discriminator: {
                  propertyName: "kind",
                  mapping: { second: "#/components/schemas/Shared" },
                },
              },
              Shared: { type: "object", additionalProperties: true },
            },
          },
        }),
      );

      expect(printed).toContain('kind: "first" | "second";');

      expect(printed).toMatch(
        /First: components\["schemas"\]\["Shared"\] & \{[^}]*kind: "first";/s,
      );

      expect(printed).toMatch(
        /Second: components\["schemas"\]\["Shared"\] & \{[^}]*kind: "second";/s,
      );
    }),
  );

  it.effect("narrows each union when a component uses different discriminator properties", () =>
    Effect.gen(function* () {
      const printed = yield* run(
        document({
          components: {
            schemas: {
              ByKind: {
                oneOf: [{ $ref: "#/components/schemas/Shared" }],
                discriminator: {
                  propertyName: "kind",
                  mapping: { byKind: "#/components/schemas/Shared" },
                },
              },
              ByCategory: {
                oneOf: [{ $ref: "#/components/schemas/Shared" }],
                discriminator: {
                  propertyName: "category",
                  mapping: { byCategory: "#/components/schemas/Shared" },
                },
              },
              Shared: { type: "object", additionalProperties: true },
            },
          },
        }),
      );

      expect(printed).toMatch(
        /ByKind: components\["schemas"\]\["Shared"\] & \{[^}]*kind: "byKind";/s,
      );

      expect(printed).toMatch(
        /ByCategory: components\["schemas"\]\["Shared"\] & \{[^}]*category: "byCategory";/s,
      );

      expect(printed).toMatch(/Shared: \{\s*\[key: string\]: unknown;\s*\};/);
    }),
  );

  it.effect("exports component and operation aliases with rootTypes", () =>
    Effect.gen(function* () {
      const model = document({
        ...petstore,
        paths: {
          ...petstore.paths,
          "/http": { get: { operationId: "getHTTP", responses: { "200": { description: "OK" } } } },
        },
        webhooks: {
          updated: {
            post: { operationId: "onPetUpdate", responses: { "200": { description: "OK" } } },
          },
        },
        components: {
          ...petstore.components,
          pathItems: {
            Shared: {
              get: { operationId: "getShared", responses: { "200": { description: "OK" } } },
            },
          },
        },
      });

      const printed = yield* run(model, { rootTypes: true });
      expect(printed).toContain('export type Pet = components["schemas"]["Pet"];');
      expect(printed).toContain('export type ListPets = operations["listPets"];');
      expect(printed).toContain('export type GetHTTP = operations["getHTTP"];');
      expect(printed).toContain('export type OnPetUpdate = operations["onPetUpdate"];');
      expect(printed).toContain('export type GetShared = operations["getShared"];');

      const withoutAliases = yield* run(model);
      expect(withoutAliases).not.toContain("export type Pet =");
      expect(withoutAliases).not.toContain("export type ListPets =");
    }),
  );

  it.effect("avoids root alias collisions with components and ApiPaths", () =>
    Effect.gen(function* () {
      const model = document({
        ...petstore,
        paths: {
          ...petstore.paths,
          "/other": {
            get: { operationId: "ListPets", responses: { "200": { description: "OK" } } },
          },
        },
        components: {
          schemas: {
            ...petstore.components.schemas,
            ListPets: { type: "string" },
            ApiPaths: { type: "string" },
          },
        },
      });

      const printed = yield* run(model, { rootTypes: true });
      expect(printed).toContain('export type ListPets = components["schemas"]["ListPets"];');
      expect(printed).toContain('export type ListPets_2 = operations["listPets"];');
      expect(printed).toContain('export type ListPets_3 = operations["ListPets"];');
      expect(printed).toContain('export type ApiPaths_2 = components["schemas"]["ApiPaths"];');
    }),
  );

  it.effect("turns a throwing hook into a TypegenError", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        run(document(petstore), {
          transform: () => {
            throw new Error("hook failed");
          },
        }),
      );

      expect(error._tag).toBe("TypegenError");
      expect(error.message).toBe("hook failed");
    }),
  );

  it.effect("validates hook options instead of silently ignoring non-functions", () =>
    Effect.gen(function* () {
      yield* Effect.forEach(
        ["transform", "postTransform", "transformProperty"],
        Effect.fnUntraced(function* (name) {
          const error = yield* Effect.flip(run(document({}), { [name]: "invalid" }));
          expect(error._tag).toBe("TypegenError");
          expect(error.message).toContain(name);
        }),
        { discard: true },
      );

      yield* run(document({}), {
        transform: undefined,
        postTransform: undefined,
        transformProperty: undefined,
      });
    }),
  );

  it.effect("lets transform replace a schema's type", () =>
    Effect.gen(function* () {
      const printed = yield* run(
        document({
          components: { schemas: { When: { type: "string", format: "date-time" } } },
        }),
        {
          transform: (schema: { format?: string }) =>
            schema.format === "date-time" ? ts.factory.createTypeReferenceNode("Date") : undefined,
        },
      );

      expect(printed).toContain("When: Date;");
    }),
  );
});

describe("generating from a raw document", () => {
  it.effect("keeps false schemas as never through preparation and generation", () =>
    Effect.gen(function* () {
      const printed = yield* generateTypes({
        openapi: "3.1.0",
        info: { title: "Test", version: "1.0.0" },
        components: { schemas: { Impossible: false } },
      });

      expect(printed).toContain("Impossible: never;");
    }),
  );

  it.effect("bundles an OpenAPI 3.0 document first, so nullable becomes null", () =>
    Effect.gen(function* () {
      const printed = yield* generateTypes({
        openapi: "3.0.3",
        info: { title: "Test", version: "1.0.0" },
        paths: {},
        components: {
          schemas: {
            Pet: { type: "object", properties: { name: { type: "string", nullable: true } } },
            Owner: { $ref: "#/components/schemas/Pet", nullable: true },
          },
        },
      });

      expect(printed).toContain("name?: string | null;");
      expect(printed).toContain('Owner: components["schemas"]["Pet"] | null;');
    }),
  );
});
