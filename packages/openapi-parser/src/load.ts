import { Readable } from "node:stream";
import { NodeStream } from "@effect/platform-node";
import { Effect, FileSystem, Path, Predicate, Stream } from "effect";
import { HttpClient } from "effect/http";
import { decodeDocument, type OpenAPIDocument } from "./document.js";
import { EmptySource, InvalidSource, ParseError, type LoadError } from "./errors.js";
import { parseYamlDocument } from "./yaml.js";

export interface LoadOptions {
  readonly cwd?: URL | string;
}

export interface LoadedDocument {
  readonly document: OpenAPIDocument;
  readonly absoluteRef: string;
  readonly sourceText?: string;
}

const emptyPath = "Empty schema. Please specify a URL or file path";
const emptySchema = "Can’t parse empty schema";

type LoadServices = FileSystem.FileSystem | Path.Path | HttpClient.HttpClient;

export const loadDocument = Effect.fn("loadDocument")(function* (
  source: unknown,
  options?: LoadOptions,
): Effect.fn.Return<LoadedDocument, LoadError, LoadServices> {
  const path = yield* Path.Path;
  const cwd = yield* resolveCwd(path, options?.cwd);

  if (source == null || source === "") return yield* new EmptySource({ message: emptyPath });
  const loaded = yield* parseSource(source, cwd);
  const document = yield* Effect.fromResult(decodeDocument(loaded.document));
  return { ...loaded, document };
});

/** A parsed source, before its version is checked. */
interface SourceDocument {
  readonly document: Record<string, unknown>;
  readonly absoluteRef: string;
  readonly sourceText?: string;
}

const parseSource = Effect.fnUntraced(function* (
  source: unknown,
  absoluteRef: string,
): Effect.fn.Return<SourceDocument, LoadError, LoadServices> {
  if (source == null || source === "") return yield* new EmptySource({ message: emptySchema });

  if (source instanceof URL) {
    const ref = source.protocol === "file:" ? yield* filePath(source) : source.href;

    const sourceText =
      source.protocol === "file:" ? yield* readFile(ref) : yield* fetchText(source.href);

    const parsed = yield* parseText(sourceText);
    const document = yield* requireDocument(parsed);
    return { document, absoluteRef: ref, sourceText };
  }

  if (source instanceof Readable) {
    const contents = yield* readReadable(source);
    return yield* parseSource(contents, absoluteRef);
  }

  if (source instanceof Buffer) return yield* parseSource(source.toString("utf8"), absoluteRef);

  if (typeof source === "string") {
    if (
      source.startsWith("http://") ||
      source.startsWith("https://") ||
      source.startsWith("file://")
    ) {
      const url = yield* Effect.try({
        try: () => new URL(source),
        catch: (cause) =>
          new InvalidSource({
            message: Predicate.isError(cause) ? cause.message : `Expected a valid URL`,
          }),
      });

      return yield* parseSource(url, absoluteRef);
    }

    const parsed = yield* parseText(source);
    const document = yield* requireDocument(parsed);
    return { document, absoluteRef, sourceText: source };
  }

  if (Predicate.isObject(source)) return { document: source, absoluteRef };

  return yield* new InvalidSource({
    message: `Expected string, object, or Buffer. Got ${Array.isArray(source) ? "Array" : typeof source}`,
  });
});

function resolveCwd(path: Path.Path, cwd: LoadOptions["cwd"]) {
  if (cwd instanceof URL) {
    if (cwd.protocol !== "file:") return Effect.succeed(cwd.href);
    return path.fromFileUrl(cwd).pipe(Effect.mapError(parseFailure));
  }

  return Effect.succeed(typeof cwd === "string" ? path.resolve(cwd) : path.resolve("."));
}

const filePath = Effect.fnUntraced(function* (
  url: URL,
): Effect.fn.Return<string, ParseError, Path.Path> {
  const path = yield* Path.Path;
  return yield* path.fromFileUrl(url).pipe(Effect.mapError(parseFailure));
});

const readFile = Effect.fnUntraced(function* (
  file: string,
): Effect.fn.Return<string, ParseError, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(file).pipe(Effect.mapError(parseFailure));
});

const fetchText = Effect.fnUntraced(function* (
  url: string,
): Effect.fn.Return<string, ParseError, HttpClient.HttpClient> {
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);

  return yield* client.get(url).pipe(
    Effect.flatMap((response) => response.text),
    Effect.mapError(parseFailure),
  );
});

function readReadable(source: Readable) {
  return NodeStream.fromReadable({
    evaluate: () => source,
    onError: parseFailure,
  }).pipe(
    Stream.decodeText,
    Stream.mkString,
    Effect.map((text) => text.trim()),
  );
}

const parseText = Effect.fnUntraced(function* (source: string) {
  if (source[0] === "{") {
    return yield* Effect.try({
      try: () => JSON.parse(source) as unknown,
      catch: parseFailure,
    });
  }

  return yield* Effect.try({
    try: () => parseYamlDocument(source),
    catch: parseFailure,
  });
});

const requireDocument = Effect.fnUntraced(function* (
  value: unknown,
): Effect.fn.Return<Record<string, unknown>, InvalidSource> {
  if (Predicate.isObject(value)) return value;

  return yield* new InvalidSource({
    message: `Expected an OpenAPI document object. Got ${valueKind(value)}`,
  });
});

function parseFailure(cause: unknown): ParseError {
  return new ParseError({
    message: Predicate.isError(cause) ? cause.message : String(cause),
    cause,
  });
}

function valueKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "Array";
  return typeof value;
}
