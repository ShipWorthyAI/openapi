import { assert, layer } from "@effect/vitest";
import { Console, Effect, Layer, MutableRef } from "effect";
import { TestConsole } from "effect/testing";
import { Linter } from "../src/index.ts";

const duplicateOperationIds = `openapi: 3.1.0
info:
  title: Test
  version: 1.0.0
servers:
  - url: https://example.com
paths:
  /a:
    get:
      operationId: list
      responses:
        "200":
          description: ok
  /b:
    get:
      operationId: list
      responses:
        "200":
          description: ok
`;

const missingPathParam = `openapi: 3.1.0
info:
  title: Test
  version: 1.0.0
paths:
  /pets/{id}:
    get:
      operationId: getPet
      responses:
        "200":
          description: ok
`;

const malformedYaml = `openapi: 3.1.0
info:
  title: Test
  title: Duplicate
  version: 1.0.0
paths: {}
`;

layer(Layer.mergeAll(Linter.layer, TestConsole.layer))("Linter", (it) => {
  it.effect("rejects input that is not an OpenAPI 3 document", () =>
    Effect.gen(function* () {
      const linter = yield* Linter;

      for (const source of ["[]", "swagger: '2.0'\n", {}]) {
        const error = yield* Effect.flip(linter.lintDocument(source));
        assert.equal(error._tag, "LintError");
        assert.equal(error.diagnostics[0]?.code, "unsupported-format");
      }
    }),
  );

  it.effect("warns when servers are missing", () =>
    Effect.gen(function* () {
      const warnings = MutableRef.make<Array<string>>([]);
      const current = yield* Console.Console;

      const recorder = Object.assign(Object.create(current), {
        warn: (...args: ReadonlyArray<unknown>) => {
          warnings.current.push(args.map(String).join(" "));
        },
      }) as Console.Console;

      const linter = yield* Linter;

      yield* linter
        .lintDocument(
          `openapi: 3.1.0
info:
  title: Test
  version: 1.0.0
paths: {}
`,
          { sourceUrl: "file:///openapi.yaml" },
        )
        .pipe(Effect.provideService(Console.Console, recorder));

      const errors = yield* TestConsole.errorLines;

      assert.strictEqual(errors.length, 0);

      assert.isTrue(
        warnings.current.some((line) => line.includes('OpenAPI "servers" must be present')),
      );
    }),
  );

  it.effect("fails when operationIds are duplicated", () =>
    Effect.gen(function* () {
      const linter = yield* Linter;

      const error = yield* Effect.flip(
        linter.lintDocument(duplicateOperationIds, { sourceUrl: "file:///openapi.yaml" }),
      );

      const errors = yield* TestConsole.errorLines;

      assert.isTrue(/operationId/i.test(error.message));

      assert.isTrue(
        error.diagnostics.some(
          (diagnostic) =>
            diagnostic.code === "operation-operationId-unique" ||
            /operationId/i.test(diagnostic.message),
        ),
      );

      assert.isTrue(errors.length > 0);
    }),
  );

  it.effect("reports unresolved schema refs", () =>
    Effect.gen(function* () {
      const linter = yield* Linter;

      const error = yield* Effect.flip(
        linter.lintDocument({
          openapi: "3.1.0",
          info: { title: "test", version: "1.0" },
          components: {
            schemas: {
              Pet: {
                type: "object",
                properties: {
                  category: { $ref: "#/components/schemas/NonExistingSchema" },
                  type: { $ref: "#/components/schemas/AnotherSchema" },
                },
              },
            },
          },
        }),
      );

      const errors = yield* TestConsole.errorLines;
      const rendered = errors.map(String).join("\n");

      assert.isTrue(
        error.diagnostics.some((diagnostic) => diagnostic.message.includes("NonExistingSchema")),
      );

      assert.isTrue(
        error.diagnostics.some((diagnostic) => diagnostic.message.includes("AnotherSchema")),
      );

      assert.isTrue(rendered.includes("#/components/schemas/NonExistingSchema"));
      assert.isTrue(rendered.includes("#/components/schemas/AnotherSchema"));
    }),
  );

  it.effect("warns on missing path params unless strict", () =>
    Effect.gen(function* () {
      const linter = yield* Linter;

      yield* linter.lintDocument(missingPathParam, { silent: true });

      const error = yield* Effect.flip(linter.lintDocument(missingPathParam, { strict: true }));

      assert.isTrue(error.diagnostics.some((diagnostic) => diagnostic.code === "path-params"));
    }),
  );

  it.effect("fails on YAML syntax errors only when strict", () =>
    Effect.gen(function* () {
      const linter = yield* Linter;

      yield* linter.lintDocument(malformedYaml, { silent: true });

      const error = yield* Effect.flip(linter.lintDocument(malformedYaml, { strict: true }));

      assert.isTrue(error.diagnostics.some((diagnostic) => diagnostic.code === "parser"));
    }),
  );

  it.effect("keeps oas3-schema off when strict", () =>
    Effect.gen(function* () {
      const linter = yield* Linter;

      yield* linter.lintDocument(
        { openapi: "3.1.0", info: { title: "Test", version: "1" } },
        { silent: true, strict: true },
      );
    }),
  );
});
