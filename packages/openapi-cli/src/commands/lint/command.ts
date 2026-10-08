import { Linter } from "@shipworthy/openapi-validator";
import { Effect, FileSystem, Path } from "effect";
import { Argument, Command } from "effect/cli";
import { HttpClient } from "effect/http";
import { asCliError, schemaSource } from "../input";

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
  function* ({ input }: { readonly input: URL }) {
    const source = yield* readSource(input);
    yield* Linter.use((linter) => linter.lintDocument(source, { sourceUrl: input.href }));
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
  ]),
);
