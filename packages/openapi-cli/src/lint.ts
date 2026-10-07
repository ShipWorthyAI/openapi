import { loadDocument } from "@shipworthy/openapi-parser";
import { lintDocument } from "@shipworthy/openapi-validator";
import { Effect } from "effect";
import { Argument, Command } from "effect/cli";
import { schemaUrl } from "./client-files";
import { fail, userError } from "./user-error";

export const lint = Command.make(
  "lint",
  {
    input: Argument.String("input").pipe(Argument.withDescription("OpenAPI schema file or URL.")),
  },
  ({ input }) =>
    Effect.gen(function* () {
      if (input.includes("*")) return yield* fail("Globbing is unsupported.");
      const source = yield* schemaUrl(input);
      const document = yield* loadDocument(source).pipe(Effect.mapError(userError));
      yield* lintDocument(document).pipe(Effect.mapError(userError));
    }),
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
