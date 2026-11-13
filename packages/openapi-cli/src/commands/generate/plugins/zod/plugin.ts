import { generate as transform } from "@shipworthy/openapi-generator";
import { Clock, Effect, FileSystem, Option, Path, Result, Schema } from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";
import { asCliError, schemaSource } from "../../../input.ts";
import { ensureDependencies } from "../../ensure.ts";
import { force } from "../../force.ts";
import { publish } from "../../publish.ts";
import { fileHeader, generatorStamp, hasCamelCaseHeader, readStamp } from "../../stamp.ts";
import { typeFlags, type TypeFlags } from "../typescript/flags.ts";
import { typescriptSpecifier } from "../typescript/plugin.ts";

export const dependencies = ["typescript"] as const;

const specifier = "@shipworthy/openapi-zod";

const run = Effect.fn("run")(function* (
  flags: {
    readonly input: URL;
    readonly output: string;
    readonly force: boolean;
  } & TypeFlags,
) {
  if (flags.camelCase) {
    return yield* new CliError.UserError({
      cause:
        "--camel-case is not supported by generate zod because its validators use API field names.",
    });
  }

  const started = yield* Clock.currentTimeMillis;
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const outputPath = path.resolve(flags.output);
  const typesPath = path.join(path.dirname(outputPath), "types.ts");
  const existing = yield* fs.readFileString(typesPath).pipe(Effect.option);

  if (Option.isSome(existing)) {
    const camelCase = hasCamelCaseHeader(existing.value);

    const camelCaseStamp = camelCase
      ? undefined
      : yield* generatorStamp(typescriptSpecifier, flags.input, true);

    if (camelCase || readStamp(existing.value) === camelCaseStamp?.stamp) {
      return yield* new CliError.UserError({
        cause: `Cannot generate Zod validators beside camelCase ${typesPath}. Use a separate output directory so Zod can write wire types.`,
      });
    }
  }

  yield* ensureDependencies(dependencies, {
    source: flags.input,
    directory: path.dirname(outputPath),
    started,
    force: flags.force,
    typeFlags: flags,
  });

  const decoded = Schema.decodeUnknownResult(Schema.String)(
    yield* transform({
      specifier,
      exportName: "zod",
      source: flags.input,
      pluginOptions: { outputPath },
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
    ...typeFlags,
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
