import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { workspace } from "./cli.ts";

test("rejects unknown flags", async (context) => {
  const { expect } = context;
  const cli = workspace(context);
  expect(await cli.fails("generate", "typescript", "--unknown-option")).toMatch(/unknown-option/);
});

test("uses default array-length inference and ApiPaths, with optional root aliases", async (context) => {
  const { expect } = context;
  const cli = workspace(context);

  writeFileSync(
    join(cli.dir, "source.json"),
    JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Pets", version: "1" },
      paths: {
        "/pets": { get: { operationId: "listPets", responses: { "200": { description: "OK" } } } },
      },
      components: {
        schemas: {
          pet: {
            type: "object",
            properties: {
              tags: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 },
            },
          },
        },
      },
    }),
  );

  const [printed, aliases, arrays] = await Promise.all([
    cli.ok("generate", "typescript", "source.json"),
    cli.ok("generate", "typescript", "source.json", "--root-types"),
    cli.ok("generate", "typescript", "source.json", "--no-array-length"),
  ]);

  expect(printed).toContain("export enum ApiPaths");
  expect(printed).toContain('listPets = "/pets"');
  expect(printed).toMatch(/tags\?: \[\s*string,\s*string\s*\];/);
  expect(printed).not.toContain("export type Pet =");

  expect(aliases).toContain('export type Pet = components["schemas"]["pet"];');
  expect(aliases).toContain('export type ListPets = operations["listPets"];');

  expect(arrays).toContain("tags?: string[];");
});

test("--camel-case changes generated field and parameter names", async (context) => {
  const { expect } = context;
  const cli = workspace(context);

  writeFileSync(
    join(cli.dir, "source.json"),
    JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Pets", version: "1" },
      paths: {
        "/pets/{pet_id}": {
          get: {
            operationId: "getPet",
            parameters: [
              { name: "pet_id", in: "path", required: true, schema: { type: "string" } },
            ],
            responses: { "200": { description: "OK" } },
          },
        },
      },
      components: {
        schemas: {
          Pet: { type: "object", properties: { first_name: { type: "string" } } },
        },
      },
    }),
  );

  const raw = await cli.ok("generate", "typescript", "source.json");
  const camel = await cli.ok("generate", "typescript", "source.json", "--camel-case");

  expect(raw).toContain("first_name?: string;");
  expect(raw).toContain("pet_id: string;");
  expect(camel).toContain("firstName?: string;");
  expect(camel).toContain("petId: string;");
  expect(camel).toContain('"/pets/{pet_id}"');
});

test("generates TypeScript from an overlaid document without changing the source", async (context) => {
  const { expect } = context;
  const cli = workspace(context);

  const source = {
    openapi: "3.1.0",
    info: { title: "Pets", version: "1" },
    paths: {
      "/old": {
        get: {
          operationId: "getOldPet",
          deprecated: true,
          responses: { "200": { description: "OK" } },
        },
      },
    },
    components: {
      schemas: {
        Pet: {
          type: "object",
          required: ["legacy"],
          properties: {
            name: { type: "string" },
            legacy: { type: "string", deprecated: true },
          },
        },
      },
    },
  };

  writeFileSync(join(cli.dir, "source.json"), JSON.stringify(source));

  const original = await cli.ok("generate", "typescript", "source.json");
  expect(original).toContain("name?: string;");
  expect(original).toContain("legacy: string;");
  expect(original).toContain("getOldPet");

  writeFileSync(
    join(cli.dir, "overlay.json"),
    JSON.stringify({
      overlay: "1.1.0",
      info: { title: "Type generation", version: "1" },
      actions: [
        { target: "$.components.schemas.Pet.properties[?@.deprecated == true]", remove: true },
        { target: "$.components.schemas.Pet", update: { required: ["name"] } },
        { target: "$.paths['/old'].get", remove: true },
      ],
    }),
  );

  await cli.ok("overlay", "source.json", "--overlay", "overlay.json", "-o", "overlaid.json");
  const printed = await cli.ok("generate", "typescript", "overlaid.json");
  expect(printed).toContain("name: string;");
  expect(printed).not.toContain("legacy");
  expect(printed).not.toContain("getOldPet");
  expect(JSON.parse(readFileSync(join(cli.dir, "source.json"), "utf8"))).toEqual(source);
});
