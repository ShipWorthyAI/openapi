import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const cli = resolve(import.meta.dirname, "../../openapi-cli/src/bin.ts");

const schema = {
  openapi: "3.1.0",
  info: { title: "Fixture", version: "1" },
  paths: {
    "/items": {
      post: {
        operationId: "createItem",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Item" },
            },
          },
        },
        responses: { "204": { description: "Created" } },
      },
    },
  },
  components: {
    schemas: {
      Item: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          count: { type: "integer", default: 1 },
        },
      },
    },
  },
};

void test("CLI writes types and Zod validators", async () => {
  const directory = await mkdtemp(resolve(import.meta.dirname, ".generation-"));
  const input = resolve(directory, "schema.json");
  await writeFile(input, JSON.stringify(schema));

  try {
    await exec("bun", ["run", cli, "generate", "zod", input, "-o", directory, "--name", "fixture"]);
    const schemas = await readFile(resolve(directory, "fixture/schemas.ts"), "utf8");
    const types = await readFile(resolve(directory, "fixture/types.ts"), "utf8");
    assert.match(schemas, /export const Item/);
    assert.doesNotMatch(schemas, /from "\.\/types"/);
    assert.match(types, /export interface components/);

    assert.match(
      await readFile(resolve(directory, "fixture/operations.ts"), "utf8"),
      /createItemRequestBody/,
    );

    await writeFile(
      resolve(directory, "consumer.ts"),
      `
      import { Item } from "./fixture/schemas";
      import { createItemRequestBody } from "./fixture/operations";
      import type { components } from "./fixture/types";
      Item.parse({ name: "Hotel" });
      createItemRequestBody.parse({ name: "Hotel" });
      const name: components["schemas"]["Item"]["name"] = "Hotel";
      void name;
    `,
    );

    const compilers = [
      resolve(import.meta.dirname, "../node_modules/typescript/bin/tsc"),
      resolve(import.meta.dirname, "../../../node_modules/typescript/bin/tsc"),
    ].filter((path) => existsSync(path));

    assert.ok(compilers.length > 0);

    for (const compiler of compilers) {
      await exec(process.execPath, [
        compiler,
        "--ignoreConfig",
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--target",
        "ES2022",
        "--module",
        "ESNext",
        "--moduleResolution",
        "bundler",
        resolve(directory, "consumer.ts"),
      ]);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
