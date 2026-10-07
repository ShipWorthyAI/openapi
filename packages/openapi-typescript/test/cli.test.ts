import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import stripAnsi from "strip-ansi";
import { type SpawnOptions, spawn } from "./spawn.js";

const root = new URL("../", import.meta.url);
const cwd = fileURLToPath(root);
const cli = fileURLToPath(new URL("../../openapi-cli/src/bin.ts", import.meta.url));

const run = (args: string[] = [], options: SpawnOptions = {}) =>
  spawn(["bun", cli, "generate", "typescript", ...args], { cwd, ...options });

const TIMEOUT = 30_000;

describe("CLI", () => {
  test("--help", async () => {
    const { stdout } = await run(["--help"], { cwd });
    expect(stdout).toContain("Convert an OpenAPI schema to TypeScript.");
  });

  test("--version", async () => {
    const { stdout } = await run(["--version"], { cwd });
    expect(stdout.trim()).toMatch(/^openapi v[\d.]+(-.*)?$/);
  });

  test(
    "stdin",
    async () => {
      const input = fs.readFileSync(new URL("./test/examples/simple/schema.yaml", root));
      const { stdout } = await run([], { input, cwd, stripFinalNewline: false });

      const expected = fs.readFileSync(
        new URL("./test/examples/simple/default/types.ts", root),
        "utf8",
      );

      expect(stdout).toBe(expected);
    },
    TIMEOUT,
  );

  test(
    "--check",
    async () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openapi-check-"));
      const schema = path.join(directory, "openapi.yaml");
      const output = path.join(directory, "types.ts");

      fs.writeFileSync(
        schema,
        "openapi: 3.1.0\ninfo:\n  title: Test\n  version: 1.0.0\npaths: {}\n",
      );

      try {
        await run([schema, "-o", output], { cwd });
        await run([schema, "-o", output, "--check"], { cwd });
        fs.writeFileSync(output, "export type stale = string;\n");

        await expect(run([schema, "-o", output, "--check"], { cwd })).rejects.toThrow(
          /not up-to-date/,
        );
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
    TIMEOUT,
  );

  test(
    "lint",
    async () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openapi-lint-"));
      const schema = path.join(directory, "openapi.yaml");

      fs.writeFileSync(
        schema,
        "openapi: 3.1.0\ninfo:\n  title: Test\n  version: 1.0.0\npaths: {}\n",
      );

      try {
        const { stderr } = await spawn(["bun", cli, "lint", schema], { cwd });
        expect(stripAnsi(stderr)).toMatch(/OpenAPI "servers" must be present/);
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
    TIMEOUT,
  );
});
