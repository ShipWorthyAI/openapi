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
        export type operations = Record<string, never>;"
      `);
    }),
  );

  it.effect("exports type aliases with exportType, and an ApiPaths enum with makePathsEnum", () =>
    Effect.gen(function* () {
      const printed = yield* run(document(petstore), { exportType: true, makePathsEnum: true });

      expect(printed).toContain("export type paths = {");
      expect(printed).toContain('listPets = "/pets"');
    }),
  );

  it.effect("rejects options of the wrong type", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(run(document({}), { alphabetize: "yes" }));
      expect(error._tag).toBe("TypegenError");
      expect(error.message).toContain("alphabetize");
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
