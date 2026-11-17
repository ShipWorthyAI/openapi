import { loadService } from "@shipworthy/openapi-generator";
import { Clock, Effect, Option, Path, Result } from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";
import { asCliError, schemaSource } from "../input.ts";
import { typeFlags, type TypeFlags } from "./flags.ts";
import { checkFiles, writeFiles, writeStdout } from "./output.ts";
import { ClientName, planFiles } from "./plan.ts";
import { renderFile } from "./render.ts";
import { readSource, readStdin } from "./source.ts";

const run = Effect.fn("generate")(function* (
  flags: {
    readonly plugins: ReadonlyArray<string>;
    readonly input: Option.Option<URL>;
    readonly output: Option.Option<string>;
    readonly name: Option.Option<string>;
    readonly wireTypes: boolean;
    readonly validationMiddleware: boolean;
    readonly check: boolean;
  } & TypeFlags,
) {
  const path = yield* Path.Path;

  const files = planFiles({
    plugins: flags.plugins,
    output: flags.output,
    outputName: Option.map(flags.output, (output) => path.basename(path.resolve(output))),
    name: flags.name,
    camelCase: flags.camelCase,
    wireTypes: flags.wireTypes,
    validationMiddleware: flags.validationMiddleware,
    check: flags.check,
  });

  if (Result.isFailure(files)) {
    return yield* new CliError.UserError({ cause: files.failure });
  }

  const started = yield* Clock.currentTimeMillis;

  const source = yield* Option.match(flags.input, {
    onNone: readStdin,
    onSome: (input) => Effect.succeed<URL | string>(input),
  });

  const [text, model] = yield* Effect.all(
    [typeof source === "string" ? Effect.succeed(source) : readSource(source), loadService(source)],
    { concurrency: "unbounded" },
  );

  const directory = path.resolve(Option.getOrElse(flags.output, () => "."));

  const rendered = yield* Effect.forEach(
    files.success,
    (file) =>
      renderFile(file, {
        model,
        text,
        directory,
        typeFlags: flags,
        silent: Option.isNone(flags.output),
      }),
    { concurrency: "unbounded" },
  );

  yield* Option.match(flags.output, {
    onNone: () => Effect.forEach(rendered, (file) => writeStdout(file.contents), { discard: true }),
    onSome: (output) =>
      flags.check
        ? checkFiles(rendered, directory)
        : writeFiles(rendered, {
            directory,
            label: Option.match(flags.input, { onNone: () => "stdin", onSome: (url) => url.href }),
            outputLabel: output,
            started,
          }),
  });
}, Effect.mapError(asCliError));

export const generate = Command.make(
  "generate",
  {
    plugins: Argument.String("plugins").pipe(
      Argument.withDescription(
        "Generator plugins to run, in any order: typescript, zod, tanstack-query, standard-schema.",
      ),
      Argument.variadic({ min: 1 }),
    ),
    input: Flag.String("input").pipe(
      Flag.withAlias("i"),
      Flag.withDescription("OpenAPI schema file or URL. Reads stdin when omitted."),
      Flag.optional,
      Flag.mapEffect((input) =>
        Option.match(input, {
          onNone: () => Effect.succeed(Option.none<URL>()),
          onSome: (value) => Effect.asSome(schemaSource(value)),
        }),
      ),
    ),
    output: Flag.String("output").pipe(
      Flag.withAlias("o"),
      Flag.withDescription(
        "Directory that receives the generated files. Writes the only file to stdout when omitted.",
      ),
      Flag.optional,
    ),
    name: Flag.String("name").pipe(
      Flag.withDescription(
        "tanstack-query client name: the prefix of generated exports. Defaults to the output directory name.",
      ),
      Flag.withSchema(ClientName),
      Flag.optional,
    ),
    wireTypes: Flag.Boolean("wire-types").pipe(
      Flag.withDescription(
        "Also write wire-types.ts with API field names (requires --camel-case).",
      ),
      Flag.withDefault(false),
    ),
    validationMiddleware: Flag.Boolean("validation-middleware").pipe(
      Flag.withDescription(
        "Also export openapi-fetch onRequestValidation and onResponseValidation middleware from each plugin that supports it: zod and standard-schema.",
      ),
      Flag.withDefault(false),
    ),
    check: Flag.Boolean("check").pipe(
      Flag.withDescription(
        "Write nothing; fail when a generated file in --output is missing or out of date.",
      ),
      Flag.withDefault(false),
    ),
    ...typeFlags,
  },
  run,
).pipe(
  Command.withDescription("Generate code from an OpenAPI schema with one or more plugins."),
  Command.withShortDescription("Generate types, validators, and clients"),
  Command.withExamples([
    {
      command: "openapi generate typescript -i ./openapi.yaml -o ./src/generated/api",
      description: "Write src/generated/api/types.ts",
    },
    {
      command:
        "openapi generate zod tanstack-query -i ./openapi.json -o ./src/generated/reservations --camel-case --wire-types",
      description:
        "Write client.ts, types.ts, wire-types.ts, and zod-schema.ts in src/generated/reservations",
    },
    {
      command:
        "openapi generate zod standard-schema -i ./openapi.json -o ./src/generated/api --validation-middleware",
      description:
        "Also export openapi-fetch validation middleware from zod-schema.ts and standard-schema.ts",
    },
    {
      command: "openapi generate typescript < ./openapi.json > ./types.ts",
      description: "Read stdin and write types.ts to stdout",
    },
  ]),
);
