import { Effect, FileSystem } from "effect";
import type { HttpClient } from "effect/http";
import {
  ParserFailure,
  ResolverFailure,
  UnmatchedParserFailure,
  UnmatchedResolverFailure,
  nodeErrorCode,
  type TaggedFailure,
} from "./errors.js";
import { httpResolver } from "./http.js";
import { parserPlugins, parseText } from "./parsers.js";
import type { EffectPlugin, FileInfo, Options, ResolverPlugin } from "./plugins.js";
import { promisePlugin } from "./plugins.js";
import { extensionOf, isFileSystemPath, stripHash, toFileSystemPath } from "./url.js";

export interface LoadContext {
  policy: "root" | "reference";
  resolvers: EffectPlugin<Uint8Array>[];
  parsers: EffectPlugin<unknown>[];
}

export function makeContext(
  rootUrl: string,
  options: Options,
  policy: LoadContext["policy"] = "reference",
): LoadContext {
  return {
    policy,
    resolvers: resolversFor(rootUrl, options, policy),
    parsers: parserPlugins(options),
  };
}

export const loadDocument = Effect.fnUntraced(function* (
  url: string,
  context: LoadContext,
): Effect.fn.Return<unknown, TaggedFailure, FileSystem.FileSystem | HttpClient.HttpClient> {
  const file = fileInfo(url);
  const resolvers = context.resolvers.filter((plugin) => plugin.can(file));

  if (resolvers.length === 0) {
    return yield* new UnmatchedResolverFailure({
      message: `Could not find resolver for "${url}"`,
      source: url,
    });
  }

  const bytes = yield* Effect.firstSuccessOf(resolvers.map((plugin) => plugin.run(file)));

  if (context.policy === "root") {
    return yield* parseText(bytes).pipe(
      Effect.mapError((cause) => new ParserFailure({ message: cause.message, source: url, cause })),
    );
  }

  const parsedFile: FileInfo = { ...file, data: bytes };
  const parsers = context.parsers.filter((plugin) => plugin.can(parsedFile));
  const selected = parsers.length > 0 ? parsers : context.parsers;

  if (selected.length === 0) {
    return yield* new UnmatchedParserFailure({
      message: `Could not find parser for "${url}"`,
      source: url,
    });
  }

  const parsed = yield* Effect.firstSuccessOf(selected.map((plugin) => plugin.run(parsedFile)));
  return parsed;
});

function resolversFor(
  rootUrl: string,
  options: Options,
  policy: LoadContext["policy"],
): EffectPlugin<Uint8Array>[] {
  const plugins: EffectPlugin<Uint8Array>[] = [];
  if (options.resolve?.file !== false) plugins.push(fileResolver());
  const http = httpResolver(rootUrl, options, policy);
  if (http) plugins.push(http);
  for (const [index, plugin] of (options.resolvers ?? []).entries())
    plugins.push(customResolver(plugin, index));
  return plugins.sort((left, right) => left.order - right.order);
}

const readResolvedFile = Effect.fnUntraced(function* (
  file: FileInfo,
): Effect.fn.Return<Uint8Array, ResolverFailure, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  let filePath = toFileSystemPath(file.url);
  if (filePath.endsWith("/") || filePath.endsWith("\\")) filePath = filePath.slice(0, -1);

  return yield* fs.readFile(filePath).pipe(
    Effect.mapError(
      (error) =>
        new ResolverFailure({
          message: `Error opening file ${filePath}: ${error.message}`,
          source: filePath,
          cause: error,
          ...ioCode(error),
        }),
    ),
  );
});

function fileResolver(): EffectPlugin<Uint8Array> {
  return {
    order: 100,
    can: (file) => isFileSystemPath(file.url),
    run: readResolvedFile,
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
    (cause, file) =>
      new ResolverFailure({
        message: cause instanceof Error ? cause.message : `Error reading file "${file.url}"`,
        source: file.url,
        cause,
        ...ioCode(cause),
      }),
  );
}

function fileInfo(url: string): FileInfo {
  return { url: stripHash(url), extension: extensionOf(url) };
}

function ioCode(cause: unknown): { ioErrorCode: string } | undefined {
  const ioErrorCode = nodeErrorCode(cause);
  return ioErrorCode ? { ioErrorCode } : undefined;
}
