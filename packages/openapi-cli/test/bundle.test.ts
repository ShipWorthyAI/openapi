import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

const bin = new URL("../src/bin.ts", import.meta.url).pathname;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openapi-cli-bundle-"));

  writeFileSync(
    join(dir, "openapi.yaml"),
    `openapi: 3.0.3
info: { title: Pets, version: '1' }
paths: {}
components:
  schemas:
    Pet:
      $ref: ./pet.yaml
`,
  );

  writeFileSync(join(dir, "pet.yaml"), "type: string\nnullable: true\n");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function bundle(...args: string[]) {
  return execFileSync("bun", [bin, "bundle", ...args], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("bundles relative YAML references, upgrades 3.0, and creates the output directory", () => {
  bundle("./openapi.yaml", "./nested/bundled.openapi.json");

  const output = readFileSync(join(dir, "nested/bundled.openapi.json"), "utf8");

  expect(JSON.parse(output)).toMatchObject({
    openapi: "3.1.0",
    info: { title: "Pets", version: "1" },
    components: { schemas: { Pet: { type: ["string", "null"] } } },
  });

  expect(output).not.toContain("./pet.yaml");
  expect(output.endsWith("\n")).toBe(true);
});

test("fails without writing output when a reference is missing", () => {
  rmSync(join(dir, "pet.yaml"));

  expect(() => bundle("openapi.yaml", "bundled.json")).toThrow(/pet\.yaml/);
  expect(existsSync(join(dir, "bundled.json"))).toBe(false);
});

test("requires both positional arguments", () => {
  expect(() => bundle("openapi.yaml")).toThrow(/output/);
});
