import {
  isRecord,
  loadDocument,
  parseModel,
  type LoadError,
  type LoadedDocument,
  type ParsedOpenApi,
} from "@shipworthy/openapi-parser";
import { bundle } from "@shipworthy/openapi-ref-parser";
import { Effect } from "effect";
import { ResolveError, TransformError, thrownMessage, type MissingPlugin, type UnknownPlugin } from "./errors.js";
import { lintDocument } from "./lint.js";
import { importPlugin, type ModuleLoader, type PluginName } from "./plugins.js";

export interface GenerateOptions {
  readonly plugin: PluginName | (string & {});
  readonly source: unknown;
  readonly cwd?: URL | string;
  readonly silent?: boolean;
  /** Spectral runs for `typescript` and for `tanstack-query`, which also emits types. */
  readonly lint?: boolean;
  readonly pluginOptions?: Readonly<Record<string, unknown>>;
  readonly loadModule?: ModuleLoader;
}

export interface TanstackGeneration {
  readonly nodes: unknown;
  readonly client: unknown;
}

export const generate = Effect.fn("openapi-transformer.generate")(function* (options: GenerateOptions) {
  const loaded = yield* loadDocument(options.source, { cwd: options.cwd });
  if (options.lint) yield* lintDocument(loaded, options.silent ?? false);
  const document = yield* bundleDocument(loaded);
  const model = yield* Effect.try({
    try: () => parseModel(document),
    catch: (cause) => new TransformError({ text: thrownMessage(cause) }),
  });
  if (options.plugin === "tanstack-query") return yield* generateTanstack(model, options);
  const plugin = yield* importPlugin(options.plugin, options.loadModule);
  return yield* render(plugin, model, options.pluginOptions ?? {});
});

const generateTanstack = Effect.fnUntraced(function* (model: ParsedOpenApi, options: GenerateOptions) {
  const query = yield* importPlugin("tanstack-query", options.loadModule);
  const types = yield* importPlugin("typescript", options.loadModule);
  const nodes = yield* render(types, model, {
    defaultNonNullable: false,
    ...options.pluginOptions,
  });
  const client = yield* render(query, model, options.pluginOptions ?? {});
  return { nodes, client } satisfies TanstackGeneration;
});

function render(
  plugin: { generate(model: ParsedOpenApi, options: Readonly<Record<string, unknown>>): unknown },
  model: ParsedOpenApi,
  options: Readonly<Record<string, unknown>>,
) {
  return Effect.try({
    try: () => plugin.generate(model, options),
    catch: (cause) => new TransformError({ text: thrownMessage(cause) }),
  });
}

function bundleDocument(loaded: LoadedDocument) {
  return Effect.tryPromise({
    try: async () => {
      const bundled = await bundle(loaded.absoluteRef, loaded.document);
      if (!isRecord(bundled)) throw new Error("Bundled schema is empty");
      if (!("components" in bundled)) bundled.components = {};
      return bundled;
    },
    catch: (cause) => new ResolveError({ text: thrownMessage(cause) }),
  });
}

export type GenerateError = ResolveError | TransformError | MissingPlugin | UnknownPlugin | LoadError;
