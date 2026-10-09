import { Linter } from "@shipworthy/openapi-validator";
import { Effect, FileSystem, Path } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { HttpClient } from "effect/http";
import { asCliError, schemaSource } from "../input.js";

const readSource = Effect.fnUntraced(function* (input: URL) {
  if (input.protocol === "file:") {
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(yield* path.fromFileUrl(input));
  }

  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  return yield* client.get(input.href).pipe(Effect.flatMap((response) => response.text));
});

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
