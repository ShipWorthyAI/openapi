import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import stripAnsi from "strip-ansi";
import { type SpawnOptions, spawn } from "../scripts/spawn.js";
import type { TestCase } from "./test-helpers.js";

const root = new URL("../", import.meta.url);
const cwd = fileURLToPath(root);
const cli = fileURLToPath(new URL("../../openapi-cli/src/bin.ts", import.meta.url));

const run = (args: string[] = [], options: SpawnOptions = {}) =>
  spawn(["bun", cli, "generate", "typescript", ...args], { cwd, ...options });

const TIMEOUT = 90_000;

describe("CLI", () => {
  const tests: TestCase<any, any>[] = [
    [
      "snapshot > GitHub API",
      {
        given: ["./examples/github-api.yaml"],
        want: new URL("./examples/github-api.ts", root),
        ci: { timeout: TIMEOUT },
      },
    ],
    [
      "snapshot > GitHub API (immutable)",
      {
        given: ["./examples/github-api.yaml", "--immutable"],
        want: new URL("./examples/github-api-immutable.ts", root),
        ci: { timeout: TIMEOUT },
      },
    ],
    [
      "snapshot > GitHub API (types + immutable)",
      {
        given: ["./examples/github-api.yaml", "--immutable", "--export-type"],
        want: new URL("./examples/github-api-export-type-immutable.ts", root),
        ci: { timeout: TIMEOUT },
      },
    ],
    [
      "snapshot > GitHub API (root types)",
      {
        given: ["./examples/github-api.yaml", "--root-types"],
        want: new URL("./examples/github-api-root-types.ts", root),
        ci: { timeout: TIMEOUT },
      },
    ],
    [
      "snapshot > GitHub API (next)",
      {
        given: ["./examples/github-api-next.yaml"],
        want: new URL("./examples/github-api-next.ts", root),
        ci: { timeout: TIMEOUT },
      },
    ],
    [
      "snapshot > Octokit GHES 3.6 Diff to API",
      {
        given: ["./examples/octokit-ghes-3.6-diff-to-api.json"],
        want: new URL("./examples/octokit-ghes-3.6-diff-to-api.ts", root),
        ci: { timeout: TIMEOUT },
      },
    ],
    [
      "snapshot > Stripe API",
      {
        given: ["./examples/stripe-api.yaml"],
        want: new URL("./examples/stripe-api.ts", root),
        ci: { timeout: TIMEOUT },
      },
    ],
    [
      "snapshot > DigitalOcean",
      {
        given: ["./examples/digital-ocean-api/DigitalOcean-public.v2.yaml"],
        want: new URL("./examples/digital-ocean-api.ts", root),
        ci: { timeout: TIMEOUT },
      },
    ],
    [
      "snapshot > enum root types filtering",
      {
        given: [
          "./examples/enum-root-types.yaml",
          "--root-types",
          "--root-types-no-schema-prefix",
          "--enum",
        ],
        want: new URL("./examples/enum-root-types.ts", root),
        ci: { timeout: TIMEOUT },
      },
    ],
  ];

  for (const [testName, { given, want, ci }] of tests) {
    test.skipIf(ci?.skipIf)(
      testName,
      async () => {
        const { stdout } = await run(given, { cwd, stripFinalNewline: false });

        if (want instanceof URL) {
          await expect(stdout).toMatchFileSnapshot(fileURLToPath(want));
        } else {
          expect(stdout).toBe(`${want}\n`);
        }
      },
      ci?.timeout,
    );
  }

  test(
    "stdin",
    async () => {
      const input = fs.readFileSync(new URL("./examples/stripe-api.yaml", root));
      const { stdout } = await run([], { input, cwd, stripFinalNewline: false });

      await expect(stdout).toMatchFileSnapshot(
        fileURLToPath(new URL("./examples/stripe-api.ts", root)),
      );
    },
    TIMEOUT,
  );

  describe("flags", () => {
    test("--help", async () => {
      const { stdout } = await run(["--help"], { cwd });
      expect(stdout).toContain("Convert an OpenAPI schema to TypeScript.");
    });

    test("--version", async () => {
      const { stdout } = await run(["--version"], { cwd });
      expect(stdout.trim()).toMatch(/^openapi v[\d.]+(-.*)?$/);
    });

    test(
      "--properties-required-by-default",
      async () => {
        const { stdout } = await run(
          ["--properties-required-by-default=true", "./examples/github-api.yaml"],
          {
            cwd,
            stripFinalNewline: false,
          },
        );

        await expect(stdout).toMatchFileSnapshot(
          fileURLToPath(new URL("./examples/github-api-required.ts", root)),
        );
      },
      TIMEOUT,
    );
  });

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
