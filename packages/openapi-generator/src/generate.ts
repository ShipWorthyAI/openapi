import {
  loadDocument,
  parseModel,
  UnsupportedVersion,
  type LoadError,
  type LoadedDocument,
  type ParsedOpenApi,
} from "@shipworthy/openapi-parser";
import { runEffect } from "@shipworthy/openapi-ref-parser";
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

  const document = yield* bundleDocument(loaded);

  const model = yield* Effect.try({
    try: () => parseModel(document),
    catch: (cause) =>
      cause instanceof UnsupportedVersion
        ? cause
        : new TransformError({ message: failureMessage(cause), cause }),
  });

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
  plugin: { generate(model: ParsedOpenApi, options: Readonly<Record<string, unknown>>): unknown },
  model: ParsedOpenApi,
  options: Readonly<Record<string, unknown>>,
): Effect.fn.Return<unknown, TransformError> {
  const value = yield* Effect.try({
    try: () => plugin.generate(model, options),
    catch: pluginFailure,
  });

  if (!isPluginEffect(value)) return value;

  return yield* Effect.mapError(value, pluginFailure);
});

const bundleDocument = Effect.fnUntraced(function* (
  loaded: LoadedDocument,
): Effect.fn.Return<
  { [x: PropertyKey]: unknown },
  ResolveError,
  FileSystem.FileSystem | HttpClient.HttpClient
> {
  const bundled = yield* runEffect("bundle", [loaded.absoluteRef, loaded.document]).pipe(
    Effect.map((result) => result.schema),
    Effect.mapError((cause) => new ResolveError({ message: cause.message, cause })),
  );

  if (!Predicate.isObject(bundled)) {
    return yield* new ResolveError({ message: "Bundled schema is empty" });
  }

  return "components" in bundled ? bundled : { ...bundled, components: {} };
});

export type GenerateError =
  | ResolveError
  | TransformError
  | MissingPlugin
  | InvalidPlugin
  | LoadError;
