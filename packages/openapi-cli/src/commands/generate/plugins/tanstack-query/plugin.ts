import { generate as transform } from "@shipworthy/openapi-generator";
import { Clock, Effect, Path, Result, Schema } from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";
import { asCliError, schemaSource } from "../../../input";
import { ensureDependencies } from "../../ensure";
import { ClientName, pascalCase, writeGenerated } from "../../files";

export const dependencies = ["typescript"] as const;

const run = Effect.fn("run")(function* (flags: {
  readonly input: URL;
  readonly output: string;
  readonly name: string;
}) {
  const started = yield* Clock.currentTimeMillis;
  const path = yield* Path.Path;

  yield* ensureDependencies(dependencies, {
    source: flags.input,
    directory: path.resolve(flags.output, flags.name),
    started,
  });

  const decoded = Schema.decodeUnknownResult(Schema.String)(
    yield* transform({
      specifier: "@shipworthy/openapi-tanstack-query-utils/generator",
      exportName: "tanstackQuery",
      source: flags.input,
      pluginOptions: { prefix: pascalCase(flags.name), name: flags.name },
    }),
  );

  if (Result.isFailure(decoded)) {
    return yield* new CliError.UserError({ cause: decoded.failure });
  }

  const client = decoded.success;

  yield* writeGenerated(flags.output, flags.name, { "client.ts": client });
}, Effect.mapError(asCliError));

export const tanstackQuery = Command.make(
  "tanstack-query",
  {
    input: Argument.String("input").pipe(
      Argument.withDescription("OpenAPI schema file or URL."),
      Argument.mapEffect(schemaSource),
    ),
    output: Flag.String("output").pipe(
      Flag.withAlias("o"),
      Flag.withDescription("Directory that will contain <name>/client.ts."),
    ),
    name: Flag.String("name").pipe(
      Flag.withDescription(
        "Client name. Used as the output directory and the generated function prefix.",
      ),
      Flag.withSchema(ClientName),
    ),
  },
  run,
).pipe(
  Command.withDescription("Generate TanStack Query utils from an OpenAPI schema."),
  Command.withShortDescription("Generate TanStack Query utils"),
  Command.withExamples([
    {
      command: "openapi generate tanstack-query ./openapi.yaml -o ./src/generated --name hotels",
      description: "Write hotels/client.ts",
    },
  ]),
);
