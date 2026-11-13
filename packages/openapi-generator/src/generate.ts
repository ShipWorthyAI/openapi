import { bundleDocument } from "@shipworthy/openapi-parser";
import { decode, type ParsedService } from "@shipworthy/openapi-transformer";
import { Effect, FileSystem, Path, Predicate } from "effect";
import { HttpClient } from "effect/http";
import { ResolveError, TransformError, type InvalidPlugin, type MissingPlugin } from "./errors.ts";
import { importPlugin } from "./plugins.ts";

export interface GenerateOptions {
  readonly specifier: string;
  readonly exportName: string;
  readonly source: unknown;
  readonly cwd?: URL | string;
  readonly pluginOptions?: Readonly<Record<string, unknown>>;
}

function failureMessage(cause: unknown): string {
  return Predicate.isError(cause) ? cause.message : String(cause);
}

function pluginFailure(cause: unknown): TransformError {
  return new TransformError({ message: failureMessage(cause), cause });
}

function isPluginEffect(value: unknown): value is Effect.Effect<unknown, Error> {
  return Effect.isEffect(value);
}

const render = Effect.fnUntraced(function* (
  plugin: { generate(model: ParsedService, options: Readonly<Record<string, unknown>>): unknown },
  model: ParsedService,
  options: Readonly<Record<string, unknown>>,
): Effect.fn.Return<unknown, TransformError> {
  const value = yield* Effect.try({
    try: () => plugin.generate(model, options),
    catch: pluginFailure,
  });

  if (!isPluginEffect(value)) return value;

  return yield* Effect.mapError(value, pluginFailure);
});

export type GenerateServices = FileSystem.FileSystem | Path.Path | HttpClient.HttpClient;

export interface LoadServiceOptions {
  readonly cwd?: URL | string;
}

/** Bundle `source` and decode it into the model every generator consumes. */
export const loadService = Effect.fn("loadService")(function* (
  source: unknown,
  options?: LoadServiceOptions,
): Effect.fn.Return<ParsedService, ResolveError | TransformError, GenerateServices> {
  const document = yield* bundleDocument(source, { cwd: options?.cwd }).pipe(
    Effect.mapError((cause) => new ResolveError({ message: cause.message, cause })),
  );

  return yield* decode(document).pipe(
    Effect.mapError((cause) => new TransformError({ message: cause.message, cause })),
  );
});

export interface RunPluginOptions {
  readonly specifier: string;
  readonly exportName: string;
  readonly model: ParsedService;
  readonly pluginOptions?: Readonly<Record<string, unknown>>;
}

/** Import one generator plugin and run it against an already loaded model. */
export const runPlugin = Effect.fn("runPlugin")(function* (
  options: RunPluginOptions,
): Effect.fn.Return<unknown, TransformError | MissingPlugin | InvalidPlugin> {
  const plugin = yield* importPlugin(options.specifier, options.exportName);
  return yield* render(plugin, options.model, options.pluginOptions ?? {});
});

export const generate = Effect.fn("generate")(function* (
  options: GenerateOptions,
): Effect.fn.Return<unknown, GenerateError, GenerateServices> {
  const model = yield* loadService(options.source, { cwd: options.cwd });

  return yield* runPlugin({
    specifier: options.specifier,
    exportName: options.exportName,
    model,
    pluginOptions: options.pluginOptions,
  });
});

export type GenerateError = ResolveError | TransformError | MissingPlugin | InvalidPlugin;
