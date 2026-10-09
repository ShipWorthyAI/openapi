import { NodeServices } from "@effect/platform-node";
import { assert, it } from "@effect/vitest";
import { Array, Effect, FileSystem, Path, Record, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const Report = Schema.fromJsonString(
  Schema.Struct({
    diagnostics: Schema.Array(
      Schema.Struct({
        filename: Schema.String,
        code: Schema.optionalKey(Schema.NullOr(Schema.String)),
        severity: Schema.String,
      }),
    ),
  }),
);

const asyncFunction = "export const read = async () => 1;\n";

const effectLoop = `import { Effect } from "effect";
export const program = Effect.gen(function* () {
  for (const value of [1, 2]) { yield* Effect.succeed(value); }
});
`;

it.live(
  "enforces the root configuration and preserves client, test, and generated-code boundaries",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const workspace = yield* path.fromFileUrl(new URL("../../../", import.meta.url));
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "effect-lint-config-" });

      yield* fs.symlink(path.join(workspace, "node_modules"), path.join(directory, "node_modules"));

      const files = {
        "package.json": JSON.stringify({ type: "module" }),
        "oxlint.config.ts": `export { default } from ${JSON.stringify(path.join(workspace, "oxlint.config.ts"))};\n`,
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            strict: true,
            skipLibCheck: true,
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "bundler",
            types: [],
            noEmit: true,
          },
          include: ["packages/**/*.ts"],
        }),
        "packages/openapi-cli/src/native.ts": asyncFunction,
        "packages/openapi-parser/src/loop.ts": effectLoop,
        "packages/openapi-parser/src/strict.ts": `import { Effect } from "effect";
export const program = Effect.all([1, 2].map((value) => Effect.succeed(value)));
`,
        "packages/openapi-parser/src/suppression.ts":
          "// oxlint-disable-next-line no-debugger\nexport const value = 1;\n",
        "packages/openapi-fetch/src/client.ts": asyncFunction,
        "packages/openapi-react-query/src/client.ts": asyncFunction,
        "packages/openapi-tanstack-query/src/client.ts": asyncFunction,
        "packages/openapi-tanstack-query/src/generator.ts": asyncFunction,
        "packages/openapi-parser/test/boundary.test.ts": asyncFunction,
        "examples/sdk-fixture/src/generated/client.ts": effectLoop,
      };

      yield* Effect.forEach(
        Record.toEntries(files),
        ([filename, source]) =>
          fs
            .makeDirectory(path.dirname(path.join(directory, filename)), { recursive: true })
            .pipe(Effect.andThen(fs.writeFileString(path.join(directory, filename), source))),
        { discard: true },
      );

      const handle = yield* spawner.spawn(
        ChildProcess.make(
          process.execPath,
          [
            path.join(workspace, "node_modules/oxlint/bin/oxlint"),
            ".",
            "--format",
            "json",
            // The temporary project has no Git ignore rules for its dependency symlink.
            "--ignore-pattern",
            "node_modules/**",
          ],
          { cwd: directory },
        ),
      );

      const [status, stdout, stderr] = yield* Effect.all(
        [
          handle.exitCode,
          handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
        ],
        { concurrency: "unbounded" },
      );

      assert.strictEqual(status, 1, stderr);
      const { diagnostics } = yield* Schema.decodeEffect(Report)(stdout);

      const codes = (file: string) =>
        Array.map(
          Array.filter(diagnostics, (entry) => entry.filename === file),
          (entry) => entry.code,
        );

      assert.include(codes("packages/openapi-cli/src/native.ts"), "effecttsgo(async-function)");

      assert.include(
        codes("packages/openapi-parser/src/loop.ts"),
        "shipworthy(prefer-effect-for-each)",
      );

      assert.include(
        codes("packages/openapi-parser/src/strict.ts"),
        "effecttsgo(all-of-map-to-for-each)",
      );

      assert.include(
        codes("packages/openapi-tanstack-query/src/generator.ts"),
        "effecttsgo(async-function)",
      );

      assert.isTrue(
        diagnostics.some(
          (entry) =>
            entry.filename === "packages/openapi-parser/src/suppression.ts" &&
            entry.severity === "error",
        ),
      );

      const unexpected = Array.filter(
        diagnostics,
        (entry) =>
          ![
            "packages/openapi-cli/src/native.ts",
            "packages/openapi-parser/src/loop.ts",
            "packages/openapi-parser/src/strict.ts",
            "packages/openapi-parser/src/suppression.ts",
            "packages/openapi-tanstack-query/src/generator.ts",
          ].includes(entry.filename),
      );

      assert.deepStrictEqual(unexpected, []);
      assert.isTrue(diagnostics.every((entry) => entry.severity === "error"));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { timeout: 30_000 },
);
