import { generate as transform } from "@shipworthy/openapi-generator";
import { Clock, Effect, Path, Result, Schema } from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";
import { asCliError, schemaSource } from "../../../input.ts";
import { ensureDependencies } from "../../ensure.ts";
import { force } from "../../force.ts";
import { ClientName, pascalCase, writeGenerated } from "../../files.ts";
import { fileHeader, generatorStamp } from "../../stamp.ts";
import { typeFlags, type TypeFlags } from "../typescript/flags.ts";
import { renderTypescript, typescriptSpecifier } from "../typescript/plugin.ts";

export const dependencies = ["typescript"] as const;

const specifier = "@shipworthy/openapi-tanstack-query/generator";

const run = Effect.fn("run")(function* (
  flags: {
    readonly input: URL;
    readonly output: string;
    readonly name: string;
    readonly force: boolean;
    readonly wireTypes: boolean;
  } & TypeFlags,
) {
  if (flags.wireTypes && !flags.camelCase) {
    return yield* new CliError.UserError({
      cause: "--wire-types requires --camel-case.",
    });
  }

  const started = yield* Clock.currentTimeMillis;
  const path = yield* Path.Path;

  yield* ensureDependencies(dependencies, {
    source: flags.input,
    directory: path.resolve(flags.output, flags.name),
    started,
    force: flags.force,
    typeFlags: flags,
  });

  const decoded = Schema.decodeUnknownResult(Schema.String)(
    yield* transform({
      specifier,
      exportName: "tanstackQuery",
      source: flags.input,
      pluginOptions: {
        prefix: pascalCase(flags.name),
        name: flags.name,
        camelCase: flags.camelCase,
      },
    }),
  );

  if (Result.isFailure(decoded)) {
    return yield* new CliError.UserError({ cause: decoded.failure });
  }

  const header = fileHeader(yield* generatorStamp(specifier, flags.input, flags.camelCase));

  if (flags.wireTypes) {
    const wirePath = path.resolve(flags.output, flags.name, "wire-types.ts");

    yield* renderTypescript({
      source: flags.input,
      generator: yield* generatorStamp(typescriptSpecifier, flags.input),
      outputPath: wirePath,
      flags: { ...flags, camelCase: false },
      check: false,
      label: flags.input.href,
      outputLabel: wirePath,
      started,
    });
  }

  yield* writeGenerated(flags.output, flags.name, { "client.ts": `${header}${decoded.success}` });
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
    force,
    wireTypes: Flag.Boolean("wire-types").pipe(
      Flag.withDescription(
        "Also write wire-types.ts with API field names (requires --camel-case).",
      ),
      Flag.withDefault(false),
    ),
    ...typeFlags,
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
