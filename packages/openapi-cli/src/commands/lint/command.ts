import { loadDocument } from "@shipworthy/openapi-parser";
import { Linter } from "@shipworthy/openapi-validator";
import { Effect } from "effect";
import { Argument, Command } from "effect/cli";
import { asCliError, schemaSource } from "../input";

const run = Effect.fn("run")(
  function* ({ input }: { readonly input: URL }) {
    const document = yield* loadDocument(input);
    yield* Linter.use((linter) => linter.lintDocument(document));
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
