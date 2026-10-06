import { clientSource, generateSchema } from "@shipworthy/openapi-tanstack-query-utils/generator";
import { Effect } from "effect";
import { Command } from "effect/cli";
import { clientFlags, requireClientName, schemaUrl, writeClient } from "./client-files";
import { pascalCase, prefixTypes } from "./prefix-types";
import { userError } from "./user-error";

export const tanstackQuery = Command.make(
  "tanstack-query-utils",
  clientFlags(),
  ({ name, output, schema }) =>
    Effect.gen(function* () {
      yield* requireClientName(name);
      const document = yield* schemaUrl(schema);
      const generated = yield* Effect.tryPromise({
        try: () => generateSchema(document),
        catch: (cause) => userError(cause),
      });
      const prefix = pascalCase(name);
      const types = yield* Effect.try({
        try: () => prefixTypes(generated.nodes, prefix),
        catch: (cause) => userError(cause),
      });
      yield* writeClient(output, name, types, clientSource(prefix, name, generated.routes));
    }),
).pipe(
  Command.withDescription("Generate TanStack Query utils from an OpenAPI schema."),
  Command.withShortDescription("Generate TanStack Query utils"),
  Command.withExamples([
    {
      command:
        "openapi tanstack-query-utils http://hotels.shipworthy.localhost/docs/openapi.json -o ./src/generated --name hotels",
      description: "Write hotels/types.ts and hotels/client.ts",
    },
  ]),
);
