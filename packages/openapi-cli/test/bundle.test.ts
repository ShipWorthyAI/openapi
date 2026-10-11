import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "vitest";
import { workspace } from "./cli.ts";

function setup(context: TestContext) {
  const cli = workspace(context);

  writeFileSync(
    join(cli.dir, "openapi.yaml"),
    `openapi: 3.0.3
info: { title: Pets, version: '1' }
paths: {}
components:
  schemas:
    Pet:
      $ref: ./pet.yaml
`,
  );

  writeFileSync(join(cli.dir, "pet.yaml"), "type: string\nnullable: true\n");
  return cli;
}

test("bundles relative YAML references, upgrades 3.0, and creates the output directory", async (context) => {
  const { expect } = context;
  const cli = setup(context);
  await cli.ok("bundle", "./openapi.yaml", "./nested/bundled.openapi.json");
  const output = readFileSync(join(cli.dir, "nested/bundled.openapi.json"), "utf8");

  expect(JSON.parse(output)).toMatchObject({
    openapi: "3.1.0",
    info: { title: "Pets", version: "1" },
    components: { schemas: { Pet: { type: ["string", "null"] } } },
  });

  expect(output).not.toContain("./pet.yaml");
  expect(output.endsWith("\n")).toBe(true);
});

test("fails without writing output when a reference is missing", async (context) => {
  const { expect } = context;
  const cli = setup(context);
  rmSync(join(cli.dir, "pet.yaml"));
  expect(await cli.fails("bundle", "openapi.yaml", "bundled.json")).toMatch(/pet\.yaml/);
  expect(existsSync(join(cli.dir, "bundled.json"))).toBe(false);
});

test("requires both positional arguments", async (context) => {
  const { expect } = context;
  const cli = setup(context);
  expect(await cli.fails("bundle", "openapi.yaml")).toMatch(/output/);
});
