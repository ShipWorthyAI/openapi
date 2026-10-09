import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

const bin = new URL("../src/bin.ts", import.meta.url).pathname;

const missingPathParam = `openapi: 3.1.0
info: { title: Test, version: '1' }
paths:
  /pets/{id}:
    get:
      operationId: getPet
      responses:
        "200": { description: ok }
`;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openapi-cli-lint-"));
  writeFileSync(join(dir, "openapi.yaml"), missingPathParam);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function lint(...args: string[]) {
  return () =>
    execFileSync("bun", [bin, "lint", ...args], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
}

test("lint passes with warnings by default", () => {
  expect(lint("openapi.yaml")).not.toThrow();
});

test("lint --strict fails on error-severity oas rules", () => {
  expect(lint("--strict", "openapi.yaml")).toThrow(/path parameter|\{id\}/);
});
