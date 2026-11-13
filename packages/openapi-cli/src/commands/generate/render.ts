import { runPlugin, type RunPluginOptions } from "@shipworthy/openapi-generator";
import type { astToString } from "@shipworthy/openapi-typescript";
import { Array, Effect, Path, Predicate, Schema } from "effect";
import { CliError } from "effect/cli";
import { pluginOptions, type TypeFlags } from "./flags.ts";
import { pascalCase, plugins, type OutputFile } from "./plan.ts";
import { fileHeader, generatorStamp } from "./stamp.ts";

interface RenderContext {
  readonly model: RunPluginOptions["model"];
  /** Schema text the stamps hash. */
  readonly text: string;
  /** Absolute output directory. */
  readonly directory: string;
  readonly typeFlags: TypeFlags;
  /** Whether output goes to stdout, so generators must not log. */
  readonly silent: boolean;
}

export interface RenderedFile {
  readonly name: OutputFile["name"];
  readonly contents: string;
}

/** One plugin run: the file it renders, the shared run context, and its header. */
interface PluginRun {
  readonly file: OutputFile;
  readonly context: RenderContext;
  readonly header: string;
  /** Absolute path the file is written to. */
  readonly outputPath: string;
}

type AstNode = Exclude<Parameters<typeof astToString>[0], ReadonlyArray<unknown>>;

const AstNodes = Schema.Array(
  Schema.declare((value): value is AstNode => Predicate.hasProperty(value, "kind")),
);

const typescriptModule = Effect.tryPromise({
  try: () => import("@shipworthy/openapi-typescript"),
  catch: (cause) => new CliError.UserError({ cause }),
});

function asUserError(cause: unknown) {
  return new CliError.UserError({ cause });
}

function generate(run: PluginRun, options: Readonly<Record<string, unknown>>) {
  return runPlugin({
    ...plugins[run.file.plugin].generator,
    model: run.context.model,
    pluginOptions: options,
  });
}

/** Text output from a string-returning plugin, after the header. */
function renderText(run: PluginRun, options: Readonly<Record<string, unknown>>) {
  return generate(run, options).pipe(
    Effect.flatMap((value) =>
      Effect.mapError(Schema.decodeUnknownEffect(Schema.String)(value), asUserError),
    ),
    Effect.map((body) => `${run.header}${body}`),
  );
}

/** Prints the `typescript` plugin's AST and formats it together with the header. */
const renderTypes = Effect.fnUntraced(function* (run: PluginRun) {
  const nodes = yield* generate(
    run,
    pluginOptions({ ...run.context.typeFlags, camelCase: run.file.camelCase }, run.context.silent),
  ).pipe(
    Effect.flatMap((value) =>
      Effect.mapError(Schema.decodeUnknownEffect(AstNodes)(value), asUserError),
    ),
  );

  const types = yield* typescriptModule;

  // Print each top-level declaration on its own so a blank line separates them.
  const body = Array.map(nodes, (node) => types.astToString(node)).join("\n");

  return yield* Effect.tryPromise({
    try: () => types.formatTypeScript(`${run.header}${body}`),
    catch: asUserError,
  });
});

function renderContents(run: PluginRun) {
  const file = run.file;

  switch (file.plugin) {
    case "typescript":
      return renderTypes(run);

    case "zod":
      return renderText(run, { outputPath: run.outputPath, camelCase: file.camelCase });

    case "tanstack-query":
      return renderText(run, {
        prefix: pascalCase(file.clientName),
        name: file.clientName,
        camelCase: file.camelCase,
      });

    case "standard-schema":
      return renderText(run, { camelCase: file.camelCase });
  }
}

/** Runs the plugin for `file` against the loaded model and prepends its stamped header. */
export const renderFile = Effect.fn("renderFile")(function* (
  file: OutputFile,
  context: RenderContext,
) {
  const path = yield* Path.Path;
  const generator = plugins[file.plugin].generator;
  const stamp = yield* generatorStamp(generator.specifier, context.text, file.camelCase);
  const header = fileHeader(stamp, file.camelCase);
  const outputPath = path.join(context.directory, file.name);
  const contents = yield* renderContents({ file, context, header, outputPath });
  return { name: file.name, contents } satisfies RenderedFile;
});
