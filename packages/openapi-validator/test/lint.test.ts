import type { LoadedDocument } from "@shipworthy/openapi-parser";
import { assert, layer } from "@effect/vitest";
import { Console, Effect, Layer, MutableRef } from "effect";
import { TestConsole } from "effect/testing";
import { Linter } from "../src/index.js";

function loaded(sourceText: string): LoadedDocument {
  return {
    document: { openapi: "3.1.0" },
    absoluteRef: "file:///openapi.yaml",
    sourceText,
  };
}

const duplicateOperationIds = loaded(`openapi: 3.1.0
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
`);

layer(Layer.mergeAll(Linter.layer, TestConsole.layer))("Linter", (it) => {
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
          loaded(`openapi: 3.1.0
info:
  title: Test
  version: 1.0.0
paths: {}
`),
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
      const error = yield* Effect.flip(linter.lintDocument(duplicateOperationIds));
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
          document: {
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
          },
          absoluteRef: "memory://openapi.yaml",
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
});
