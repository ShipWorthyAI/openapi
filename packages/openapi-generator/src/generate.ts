import { bundleDocument, loadDocument, type LoadError } from "@shipworthy/openapi-parser";
import { decode, type ParsedService } from "@shipworthy/openapi-transformer";
import { Effect, FileSystem, Path, Predicate } from "effect";
import { HttpClient } from "effect/http";
import { ResolveError, TransformError, type InvalidPlugin, type MissingPlugin } from "./errors.js";
import { importPlugin } from "./plugins.js";

export interface GenerateOptions {
  readonly specifier: string;
  readonly exportName: string;
  readonly source: unknown;
  readonly cwd?: URL | string;
  readonly pluginOptions?: Readonly<Record<string, unknown>>;
}

type GenerateServices = FileSystem.FileSystem | Path.Path | HttpClient.HttpClient;

export const generate = Effect.fn("generate")(function* (
  options: GenerateOptions,
): Effect.fn.Return<unknown, GenerateError, GenerateServices> {
  const loaded = yield* loadDocument(options.source, { cwd: options.cwd });

  const document = yield* bundleDocument(loaded).pipe(
    Effect.mapError((cause) => new ResolveError({ message: cause.message, cause })),
  );

  const model = yield* decode(document).pipe(
    Effect.mapError((cause) => new TransformError({ message: cause.message, cause })),
  );

  const plugin = yield* importPlugin(options.specifier, options.exportName);
  return yield* render(plugin, model, options.pluginOptions ?? {});
});

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

export type GenerateError =
  | ResolveError
  | TransformError
  | MissingPlugin
  | InvalidPlugin
  | LoadError;
