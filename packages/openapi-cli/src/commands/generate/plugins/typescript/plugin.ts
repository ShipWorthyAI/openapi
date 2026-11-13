import { generate as transform } from "@shipworthy/openapi-generator";
import { Clock, Console, Effect, Option, Path, Stdio, Stream } from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";
import { asCliError, schemaSource } from "../../../input.ts";
import { version } from "../../../../version.ts";
import { publish } from "../../publish.ts";
import { fileHeader, generatorStamp } from "../../stamp.ts";
import { pluginOptions, typeFlags, type TypeFlags } from "./flags.ts";

export const dependencies = [] as const;

export const typescriptSpecifier = "@shipworthy/openapi-typescript";

interface TypescriptModule {
  astToString(nodes: readonly unknown[]): string;
  formatTypeScript(source: string): Promise<string>;
}

const typescriptModule = Effect.fn("typescriptModule")(function* () {
  return yield* Effect.tryPromise({
    try: () => import("@shipworthy/openapi-typescript") as Promise<TypescriptModule>,
    catch: (cause) => new CliError.UserError({ cause }),
  });
});

const readStdin = Effect.fn("readStdin")(function* () {
  const stdio = yield* Stdio.Stdio;
  return yield* stdio.stdin.pipe(Stream.decodeText(), Stream.mkString);
});

export const writeStdout = Effect.fn("writeStdout")(function* (text: string) {
  const stdio = yield* Stdio.Stdio;
  yield* Stream.run(Stream.make(text), stdio.stdout({ endOnDone: false }));
});

export const renderTypescript = Effect.fn("renderTypescript")(function* (options: {
  readonly source: URL | string;
  readonly generator: { readonly name: string; readonly stamp: string };
  readonly outputPath?: string;
  readonly flags: TypeFlags;
  readonly check: boolean;
  readonly label: string;
  readonly outputLabel: string;
  readonly started: number;
}) {
  if (options.outputPath) yield* Console.info(`openapi generate typescript ${yield* version}`);

  const nodes = yield* transform({
    specifier: typescriptSpecifier,
    exportName: "typescript",
    source: options.source,
    pluginOptions: pluginOptions({ ...options.flags, silent: options.outputPath === undefined }),
  });

  const types = yield* typescriptModule();

  // Print each top-level declaration on its own so a blank line separates them.
  const body = (nodes as readonly unknown[]).map((node) => types.astToString([node])).join("\n");

  const printed = yield* Effect.tryPromise({
    try: () =>
      types.formatTypeScript(`${fileHeader(options.generator, options.flags.camelCase)}${body}`),
    catch: (cause) => new CliError.UserError({ cause }),
  });

  if (!options.outputPath) {
    yield* writeStdout(printed);

    return;
  }

  yield* publish({
    result: printed,
    outputPath: options.outputPath,
    check: options.check,
    label: options.label,
    outputLabel: options.outputLabel,
    started: options.started,
  });
});

const run = Effect.fn("run")(function* (
  flags: {
    readonly input: Option.Option<URL>;
    readonly output: Option.Option<string>;
    readonly check: boolean;
  } & TypeFlags,
) {
  const output = Option.getOrUndefined(flags.output);
  const input = Option.getOrUndefined(flags.input);
  const started = yield* Clock.currentTimeMillis;
  const path = yield* Path.Path;
  const source = input ?? (yield* readStdin());

  yield* renderTypescript({
    source,
    generator: yield* generatorStamp(typescriptSpecifier, source, flags.camelCase),
    outputPath: output === undefined ? undefined : path.resolve(output),
    flags,
    check: flags.check,
    label: input?.href ?? "stdin",
    outputLabel: output ?? "stdout",
    started,
  });
}, Effect.mapError(asCliError));

export const typescript = Command.make(
  "typescript",
  {
    input: Argument.String("input").pipe(
      Argument.withDescription("OpenAPI schema file or URL. Omit to read stdin."),
      Argument.optional,
      Argument.mapEffect((input) =>
        Option.match(input, {
          onNone: () => Effect.succeed(Option.none<URL>()),
          onSome: (value) => Effect.asSome(schemaSource(value)),
        }),
      ),
    ),
    output: Flag.String("output").pipe(
      Flag.withAlias("o"),
      Flag.withDescription("Output file. Writes to stdout when omitted."),
      Flag.optional,
    ),
    check: Flag.Boolean("check").pipe(
      Flag.withDescription("Check that the generated types are up-to-date."),
      Flag.withDefault(false),
    ),
    ...typeFlags,
  },
  run,
).pipe(
  Command.withDescription("Convert an OpenAPI schema to TypeScript."),
  Command.withShortDescription("Generate TypeScript types"),
  Command.withExamples([
    {
      command: "openapi generate typescript ./openapi.yaml -o ./schema.ts",
      description: "Write TypeScript types for a local schema",
    },
  ]),
);
