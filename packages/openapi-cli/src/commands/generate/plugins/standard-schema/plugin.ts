import { generate as transform } from "@shipworthy/openapi-generator";
import { Clock, Effect, Option, Path, Result, Schema } from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";
import { asCliError, schemaSource } from "../../../input.js";
import { publish } from "../../publish.js";
import { fileHeader, generatorStamp } from "../../stamp.js";
import { writeStdout } from "../typescript/plugin.js";

export const dependencies = [] as const;

const specifier = "@shipworthy/openapi-standard-schema";

const run = Effect.fn("run")(function* (flags: {
  readonly input: URL;
  readonly output: Option.Option<string>;
}) {
  const output = Option.getOrUndefined(flags.output);
  const started = yield* Clock.currentTimeMillis;

  const decoded = Schema.decodeUnknownResult(Schema.String)(
    yield* transform({
      specifier,
      exportName: "standardSchema",
      source: flags.input,
    }),
  );

  if (Result.isFailure(decoded)) {
    return yield* new CliError.UserError({ cause: decoded.failure });
  }

  const text = `${fileHeader(yield* generatorStamp(specifier, flags.input))}${decoded.success}`;

  if (!output) {
    yield* writeStdout(text);

    return;
  }

  const path = yield* Path.Path;

  yield* publish({
    result: text,
    outputPath: path.resolve(output),
    check: false,
    label: flags.input.href,
    outputLabel: output,
    started,
  });
}, Effect.mapError(asCliError));

export const standardSchema = Command.make(
  "standard-schema",
  {
    input: Argument.String("input").pipe(
      Argument.withDescription("OpenAPI schema file or URL."),
      Argument.mapEffect(schemaSource),
    ),
    output: Flag.String("output").pipe(
      Flag.withAlias("o"),
      Flag.withDescription("Output file. Writes to stdout when omitted."),
      Flag.optional,
    ),
  },
  run,
).pipe(
  Command.withDescription("Generate Standard Schema validators from an OpenAPI schema."),
  Command.withShortDescription("Generate Standard Schema validators"),
  Command.withExamples([
    {
      command: "openapi generate standard-schema ./openapi.yaml -o ./schemas.ts",
      description: "Write Standard Schema validators",
    },
  ]),
);
