import { generate as transform } from "@shipworthy/openapi-generator";
import { Clock, Effect, Path, Result, Schema } from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";
import { asCliError, schemaSource } from "../../../input";
import { ensureDependencies } from "../../ensure";
import { force } from "../../force";
import { publish } from "../../publish";
import { fileHeader, generatorStamp } from "../../stamp";

export const dependencies = ["typescript"] as const;

const specifier = "@shipworthy/openapi-zod";

const run = Effect.fn("run")(function* (flags: {
  readonly input: URL;
  readonly output: string;
  readonly force: boolean;
}) {
  const started = yield* Clock.currentTimeMillis;
  const path = yield* Path.Path;
  const outputPath = path.resolve(flags.output);

  yield* ensureDependencies(dependencies, {
    source: flags.input,
    directory: path.dirname(outputPath),
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

  yield* publish({
    result: `${header}${decoded.success}`,
    outputPath,
    check: false,
    label: flags.input.href,
    outputLabel: flags.output,
    started,
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
      Flag.withDescription("Output file. types.ts is written next to it."),
    ),
    force,
  },
  run,
).pipe(
  Command.withDescription("Generate Zod validators from an OpenAPI schema."),
  Command.withShortDescription("Generate Zod validators"),
  Command.withExamples([
    {
      command: "openapi generate zod ./openapi.yaml -o ./src/generated/hotels/zod-schema.ts",
      description: "Write hotels/zod-schema.ts and hotels/types.ts",
    },
  ]),
);
