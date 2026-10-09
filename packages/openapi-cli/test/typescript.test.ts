import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

const bin = new URL("../src/bin.ts", import.meta.url).pathname;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openapi-cli-typescript-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(...args: string[]) {
  return execFileSync("bun", [bin, ...args], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("rejects unknown flags", () => {
  expect(() => run("generate", "typescript", "--unknown-option")).toThrow(/unknown-option/);
});

test("uses default array-length inference and ApiPaths, with optional root aliases", () => {
  writeFileSync(
    join(dir, "source.json"),
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

  const printed = run("generate", "typescript", "source.json");
  expect(printed).toContain("export enum ApiPaths");
  expect(printed).toContain('listPets = "/pets"');
  expect(printed).toMatch(/tags\?: \[\s*string,\s*string\s*\];/);
  expect(printed).not.toContain("export type Pet =");

  const aliases = run("generate", "typescript", "source.json", "--root-types");
  expect(aliases).toContain('export type Pet = components["schemas"]["pet"];');
  expect(aliases).toContain('export type ListPets = operations["listPets"];');

  const arrays = run("generate", "typescript", "source.json", "--no-array-length");
  expect(arrays).toContain("tags?: string[];");
});

test("applies schema changes through an overlay before TypeScript generation", () => {
  const source = {
    openapi: "3.1.0",
    info: { title: "Pets", version: "1" },
    paths: {
      "/pets/{id}": {
        get: {
          operationId: "getPet",
          parameters: [
            { name: "retired", in: "query", deprecated: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
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
            name: { type: "string", default: "Unknown" },
            count: { type: "integer", default: 0 },
            legacy: { type: "string", deprecated: true },
            archived: { $ref: "#/components/schemas/Legacy" },
          },
        },
        Empty: { type: "object", additionalProperties: false },
        Legacy: { type: "string", deprecated: true },
      },
    },
  };

  writeFileSync(join(dir, "source.json"), JSON.stringify(source));

  const original = run("generate", "typescript", "source.json");
  expect(original).toContain("name?: string;");
  expect(original).toContain("count?: number;");
  expect(original).toContain("legacy: string;");
  expect(original).toContain("Legacy: string;");
  expect(original).toContain("retired?: string;");
  expect(original).toContain("Empty: Record<string, never>;");
  expect(original).toContain('get: operations["getOldPet"];');
  expect(original).not.toContain("id: string;");

  const overlay = {
    overlay: "1.1.0",
    info: { title: "Type generation", version: "1" },
    actions: [
      { target: "$.components.schemas.Pet.properties[?@.deprecated == true]", remove: true },
      { target: "$.components.schemas.Pet.properties.archived", remove: true },
      { target: "$.components.schemas.Legacy", remove: true },
      { target: "$.components.schemas.Pet.required[?@ == 'legacy']", remove: true },
      {
        target: "$.components.schemas.Pet",
        update: { required: ["name", "count"], additionalProperties: true },
      },
      { target: "$.components.schemas.Empty", update: { additionalProperties: true } },
      { target: "$.paths['/old'].get", remove: true },
      { target: "$.paths['/pets/{id}'].get.parameters[?@.deprecated == true]", remove: true },
      {
        target: "$.paths['/pets/{id}']",
        update: {
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        },
      },
    ],
  };

  writeFileSync(join(dir, "overlay.json"), JSON.stringify(overlay));
  run("overlay", "source.json", "--overlay", "overlay.json", "-o", "overlaid.json");
  const printed = run("generate", "typescript", "overlaid.json");

  expect(printed).toContain("name: string;");
  expect(printed).toContain("count: number;");
  expect(printed).toContain("@default Unknown");
  expect(printed).toContain("[key: string]: unknown;");
  expect(printed).toContain("Empty: {");
  expect(printed).toContain("id: string;");
  expect(printed).not.toContain("legacy:");
  expect(printed).not.toContain("archived");
  expect(printed).not.toContain("Legacy:");
  expect(printed).not.toContain("retired");
  expect(printed).not.toContain("getOldPet");
  expect(JSON.parse(readFileSync(join(dir, "source.json"), "utf8"))).toEqual(source);
});
