import { Effect, FileSystem } from "effect";
import { ResolverFailure, UnmatchedParserFailure, UnmatchedResolverFailure } from "./errors.js";
import { nodeFileSystem } from "./filesystem.js";
import { httpResolver } from "./http.js";
import { parserPlugins } from "./parsers.js";
import type { EffectPlugin, FileInfo, Options, ResolverPlugin } from "./plugins.js";
import { promisePlugin } from "./plugins.js";
import { extensionOf, isFileSystemPath, stripHash, toFileSystemPath } from "./url.js";

export interface LoadContext {
  options: Options;
  resolvers: EffectPlugin<Uint8Array>[];
  parsers: EffectPlugin<unknown>[];
}

export function makeContext(rootUrl: string, options: Options): LoadContext {
  return {
    options,
    resolvers: resolversFor(rootUrl, options),
    parsers: parserPlugins(options),
  };
}

export const loadDocument = Effect.fnUntraced(function* (url: string, context: LoadContext) {
  const file = fileInfo(url);
  const resolvers = context.resolvers.filter((plugin) => plugin.can(file));

  if (resolvers.length === 0) {
    return yield* Effect.fail(
      new UnmatchedResolverFailure({
        message: `Could not find resolver for "${url}"`,
        source: url,
      }),
    );
  }

  const bytes = yield* Effect.firstSuccessOf(resolvers.map((plugin) => plugin.run(file)));
  const parsedFile: FileInfo = { ...file, data: bytes };
  const parsers = context.parsers.filter((plugin) => plugin.can(parsedFile));
  const selected = parsers.length > 0 ? parsers : context.parsers;

  if (selected.length === 0) {
    return yield* Effect.fail(
      new UnmatchedParserFailure({ message: `Could not find parser for "${url}"`, source: url }),
    );
  }

  const parsed = yield* Effect.firstSuccessOf(selected.map((plugin) => plugin.run(parsedFile)));
  return parsed;
});

function resolversFor(rootUrl: string, options: Options): EffectPlugin<Uint8Array>[] {
  const plugins: EffectPlugin<Uint8Array>[] = [];
  if (options.resolve?.file !== false) plugins.push(fileResolver());
  const http = httpResolver(rootUrl, options);
  if (http) plugins.push(http);
  for (const [index, plugin] of (options.resolvers ?? []).entries())
    plugins.push(customResolver(plugin, index));
  return plugins.sort((left, right) => left.order - right.order);
}

function fileResolver(): EffectPlugin<Uint8Array> {
  return {
    order: 100,
    can: (file) => isFileSystemPath(file.url),
    run(file) {
      return Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        let filePath = toFileSystemPath(file.url);
        if (filePath.endsWith("/") || filePath.endsWith("\\")) filePath = filePath.slice(0, -1);

        return yield* fs.readFile(filePath).pipe(
          Effect.mapError(
            (error) =>
              new ResolverFailure({
                message: `Error opening file ${filePath}: ${error.message}`,
                source: filePath,
                ioErrorCode: error.reason._tag,
              }),
          ),
        );
      });
    },
  };
}

function customResolver(plugin: ResolverPlugin, index: number): EffectPlugin<Uint8Array> {
  return promisePlugin(
    plugin.order ?? 300 + index,
    (file) => plugin.canRead(file),
    async (file) => {
      const data = await plugin.read(file);
      return typeof data === "string" ? new TextEncoder().encode(data) : data;
    },
    (cause) =>
      new ResolverFailure({
        message: cause instanceof Error ? cause.message : `Error reading file "${""}"`,
        source: "",
        ioErrorCode:
          typeof cause === "object" && cause !== null && "code" in cause
            ? String(cause.code ?? "")
            : "",
      }),
  );
}

function fileInfo(url: string): FileInfo {
  return { url: stripHash(url), extension: extensionOf(url) };
}

export function provideFileSystem<A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) {
  return effect.pipe(Effect.provideService(FileSystem.FileSystem, nodeFileSystem()));
}
