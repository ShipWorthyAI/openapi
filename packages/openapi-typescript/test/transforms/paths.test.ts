import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { transformApiPaths } from "../../src/transforms/api-paths.js";
import { transformPaths } from "../../src/transforms/paths.js";
import { transformWebhooks } from "../../src/transforms/webhooks.js";
import { document, print } from "../helpers.js";

const ok = { "200": { description: "OK" } };

describe("transformPaths", () => {
  it.effect(
    "prints each path item with every method, and moves operations with ids to `operations`",
    () =>
      Effect.gen(function* () {
        const model = document({
          paths: {
            "/pets": { get: { operationId: "listPets", responses: ok }, post: { responses: ok } },
            "/health": { $ref: "#/components/pathItems/Health" },
          },
          components: { pathItems: { Health: { get: { responses: ok } } } },
        });

        expect(yield* print(model, transformPaths(model.paths))).toMatchInlineSnapshot(`
        "{
          "/pets": {
            parameters: {
              query?: never;
              header?: never;
              path?: never;
              cookie?: never;
            };
            get: operations["listPets"];
            put?: never;
            post: {
              parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
              };
              requestBody?: never;
              responses: {
                /** @description OK */
                200: {
                  headers: {
                    [name: string]: unknown;
                  };
                  content?: never;
                };
              };
            };
            delete?: never;
            options?: never;
            head?: never;
            patch?: never;
            trace?: never;
          };
          "/health": components["pathItems"]["Health"];
        }"
      `);
      }),
  );

  it.effect("leaves deprecated operations out with excludeDeprecated", () =>
    Effect.gen(function* () {
      const model = document({
        paths: { "/old": { get: { deprecated: true, responses: ok } } },
      });

      expect(
        yield* print(model, transformPaths(model.paths), { excludeDeprecated: true }),
      ).toContain("get?: never;");
    }),
  );

  it.effect("prints template literal keys with pathParamsAsTypes", () =>
    Effect.gen(function* () {
      const model = document({
        paths: {
          "/pets/{id}": {
            get: {
              parameters: [{ name: "id", in: "path", schema: { type: "integer" } }],
              responses: ok,
            },
          },
        },
      });

      expect(
        yield* print(model, transformPaths(model.paths), { pathParamsAsTypes: true }),
      ).toContain("[path: `/pets/${number}`]: {");
    }),
  );
});

describe("transformWebhooks", () => {
  it.effect("prints webhooks by name", () =>
    Effect.gen(function* () {
      const model = document({ webhooks: { newPet: { post: { responses: ok } } } });
      expect(yield* print(model, transformWebhooks(model.webhooks))).toContain("newPet: {");
    }),
  );
});

describe("transformApiPaths", () => {
  it.effect("names enum members by operationId, or by method and path", () =>
    Effect.gen(function* () {
      const model = document({
        paths: {
          "/pets": { get: { operationId: "listPets", responses: ok } },
          "/pets/{id}": { delete: { responses: ok } },
        },
      });

      expect(yield* print(model, transformApiPaths(model.paths))).toMatchInlineSnapshot(`
        "export enum ApiPaths {
          listPets = "/pets",
          DeletePets = "/pets/{id}"
        }"
      `);
    }),
  );
});
