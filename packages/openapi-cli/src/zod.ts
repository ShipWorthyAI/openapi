import openapiTS from "@shipworthy/openapi-typescript";
import { generateZodSources } from "@shipworthy/openapi-zod";
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { clientFlags, requireClientName, schemaUrl, writeGenerated } from "./client-files";
import { pascalCase, prefixTypes } from "./prefix-types";
import { userError } from "./user-error";

export const zod = Command.make(
  "zod",
  clientFlags(
    "Directory that will contain <name>/types.ts, definitions.ts, schemas.ts, and operations.ts.",
  ),
  ({ name, output, schema }) =>
    Effect.gen(function* () {
      yield* requireClientName(name);
      const source = yield* schemaUrl(schema);
      const prefix = pascalCase(name);
      const validators = yield* Effect.tryPromise({
        try: () => generateZodSources(source, prefix),
        catch: (cause) => userError(cause),
      });
      // Defaults stay optional. The validators drop default keywords, so the
      // generated types must not treat a default as making a property required.
      const nodes = yield* Effect.tryPromise({
        try: () => openapiTS(source, { defaultNonNullable: false }),
        catch: (cause) => userError(cause),
      });
      const types = yield* Effect.try({
        try: () => prefixTypes(nodes, prefix),
        catch: (cause) => userError(cause),
      });
      yield* writeGenerated(output, name, {
        "types.ts": types,
        "definitions.ts": validators.definitions,
        "schemas.ts": validators.schemas,
        "operations.ts": validators.operations,
      });
    }),
).pipe(
  Command.withDescription(
    "Generate Zod validators and matching TypeScript types from an OpenAPI 3.1 schema.",
  ),
  Command.withShortDescription("Generate Zod validators"),
  Command.withExamples([
    {
      command: "openapi zod ./openapi.yaml -o ./src/generated --name hotels",
      description: "Write hotels/types.ts, definitions.ts, schemas.ts, and operations.ts",
    },
  ]),
);
