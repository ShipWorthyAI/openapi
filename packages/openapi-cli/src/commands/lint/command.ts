import { Linter } from "@shipworthy/openapi-validator";
import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { asCliError, readSource, schemaSource } from "../input.ts";

const run = Effect.fn("run")(
  function* ({ input, strict }: { readonly input: URL; readonly strict: boolean }) {
    const source = yield* readSource(input);
    yield* Linter.use((linter) => linter.lintDocument(source, { sourceUrl: input.href, strict }));
  },
  Effect.mapError(asCliError),
  Effect.provide(Linter.layer),
);

export const lint = Command.make(
  "lint",
  {
    input: Argument.String("input").pipe(
      Argument.withDescription("OpenAPI schema file or URL."),
      Argument.mapEffect(schemaSource),
    ),
    strict: Flag.Boolean("strict").pipe(
      Flag.withDescription(
        "Keep Spectral's oas rule severities and fail on YAML/JSON syntax errors.",
      ),
      Flag.withDefault(false),
    ),
  },
  run,
).pipe(
  Command.withDescription("Lint an OpenAPI schema and print diagnostics."),
  Command.withShortDescription("Lint an OpenAPI schema"),
  Command.withExamples([
    {
      command: "openapi lint ./openapi.yaml",
      description: "Lint a local schema",
    },
    {
      command: "openapi lint https://example.com/openapi.yaml",
      description: "Lint a remote schema",
    },
    {
      command: "openapi lint --strict ./openapi.yaml",
      description: "Fail on every error-severity oas rule and on syntax errors",
    },
  ]),
);
