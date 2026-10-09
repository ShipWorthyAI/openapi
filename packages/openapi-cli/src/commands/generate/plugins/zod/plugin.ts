import { generate as transform } from "@shipworthy/openapi-generator";
import { Clock, Effect, Path, Result, Schema } from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";
import { asCliError, schemaSource } from "../../../input";
import { ensureDependencies } from "../../ensure";
import { force } from "../../force";
import { ClientName, writeGenerated } from "../../files";
import { fileHeader, generatorStamp } from "../../stamp";

export const dependencies = ["typescript"] as const;

const specifier = "@shipworthy/openapi-zod";

const run = Effect.fn("run")(function* (flags: {
  readonly input: URL;
  readonly output: string;
  readonly name: string;
  readonly force: boolean;
}) {
  const started = yield* Clock.currentTimeMillis;
  const path = yield* Path.Path;

  yield* ensureDependencies(dependencies, {
    source: flags.input,
    directory: path.resolve(flags.output, flags.name),
    started,
    force: flags.force,
  });

  const decoded = Schema.decodeUnknownResult(Schema.String)(
    yield* transform({
      specifier,
      exportName: "zod",
      source: flags.input,
    }),
  );

  if (Result.isFailure(decoded)) {
    return yield* new CliError.UserError({ cause: decoded.failure });
  }

  const header = fileHeader(yield* generatorStamp(specifier, flags.input));

  yield* writeGenerated(flags.output, flags.name, {
    "schema.ts": `${header}${decoded.success}`,
  });
}, Effect.mapError(asCliError));

export const zod = Command.make(
  "zod",
  {
    input: Argument.String("input").pipe(
      Argument.withDescription("OpenAPI schema file or URL."),
      Argument.mapEffect(schemaSource),
    ),
    output: Flag.String("output").pipe(
      Flag.withAlias("o"),
      Flag.withDescription("Directory that will contain <name>/."),
    ),
    name: Flag.String("name").pipe(
      Flag.withDescription("Client name. Used as the output directory."),
      Flag.withSchema(ClientName),
    ),
    force,
  },
  run,
).pipe(
  Command.withDescription("Generate Zod validators from an OpenAPI schema."),
  Command.withShortDescription("Generate Zod validators"),
  Command.withExamples([
    {
      command: "openapi generate zod ./openapi.yaml -o ./src/generated --name hotels",
      description: "Write hotels/schema.ts",
    },
  ]),
);
