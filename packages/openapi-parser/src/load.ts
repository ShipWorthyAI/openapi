// oxlint-disable-next-line effecttsgo/node-builtin-import -- Detect the public Node Readable input before adapting it with NodeStream.
import { Readable } from "node:stream";
import { NodeStream } from "@effect/platform-node";
import { Effect, type FileSystem, Path, Predicate, Schema, Stream } from "effect";
import type { HttpClient } from "effect/http";
import { decodeDocument, type OpenAPIDocument } from "./document.ts";
import { EmptySource, InvalidSource, ParseError, type LoadError } from "./errors.ts";
import { loadDocument as loadResolvedDocument, makeContext } from "./loader.ts";
import { parseText } from "./parsers.ts";

const loadOptions = Schema.Struct({
  cwd: Schema.optional(Schema.Union([Schema.String, Schema.URL])),
});
export type LoadOptions = typeof loadOptions.Type;

interface LoadedDocument {
  readonly document: OpenAPIDocument;
  readonly absoluteRef: string;
}

const emptyPath = "Empty schema. Please specify a URL or file path";
const emptySchema = "Can’t parse empty schema";

type LoadServices = FileSystem.FileSystem | Path.Path | HttpClient.HttpClient;

export const loadDocument = Effect.fn("loadDocument")(function* (
  source: unknown,
  options?: LoadOptions,
): Effect.fn.Return<LoadedDocument, LoadError, LoadServices> {
  const decoded = yield* Schema.decodeEffect(loadOptions)(options ?? {}).pipe(
    Effect.mapError(parseFailure),
  );

  const path = yield* Path.Path;
  const cwd = yield* resolveCwd(path, decoded.cwd);

  if (source == null || source === "") return yield* new EmptySource({ message: emptyPath });
  const loaded = yield* parseSource(source, cwd);
  const document = yield* Effect.fromResult(decodeDocument(loaded.document));
  return { ...loaded, document };
});

/** A parsed source, before its version is checked. */
interface SourceDocument {
  readonly document: Record<string, unknown>;
  readonly absoluteRef: string;
}

const parseSource = Effect.fnUntraced(function* (
  source: unknown,
  absoluteRef: string,
): Effect.fn.Return<SourceDocument, LoadError, LoadServices> {
  if (source == null || source === "") return yield* new EmptySource({ message: emptySchema });

  if (source instanceof URL) {
    const ref = source.protocol === "file:" ? yield* filePath(source) : source.href;

    const parsed = yield* loadResolvedDocument(
      source.href,
      makeContext(source.href, {}, "root"),
    ).pipe(Effect.mapError(parseFailure));

    const document = yield* requireDocument(parsed);
    return { document, absoluteRef: ref };
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

    if (isFilePath(source, yield* Path.Path))
      return yield* parseSource(yield* fileUrl(source, absoluteRef), absoluteRef);

    const parsed = yield* parseText(source);
    const document = yield* requireDocument(parsed);
    return { document, absoluteRef };
  }

  const document = yield* Schema.decodeUnknownEffect(documentObject)(source).pipe(
    Effect.mapError(
      () =>
        new InvalidSource({
          message: `Expected string, object, or Buffer. Got ${valueKind(source)}`,
        }),
    ),
  );

  return { document, absoluteRef };
});

/**
 * A single-line string is a filesystem path when it is platform-absolute or starts with
 * `./`, `../`, `.\`, or `..\`. Otherwise, it needs a `.json`, `.yaml`, or `.yml` extension,
 * no `: `, and no leading `{` or `[`. No inline OpenAPI document
 * matches: one-line YAML needs `key: value` or `{...}`, and JSON starts with `{`.
 */
function isFilePath(source: string, path: Path.Path): boolean {
  const value = source.trim();
  if (value === "" || /[\r\n]/.test(value)) return false;
  if (
    path.isAbsolute(value) ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith(".\\") ||
    value.startsWith("..\\")
  )
    return true;

  return (
    [".json", ".yaml", ".yml"].includes(path.extname(value).toLowerCase()) &&
    !value.includes(": ") &&
    !value.startsWith("{") &&
    !value.startsWith("[")
  );
}

/** Resolve a path string against the `cwd` directory URL. */
const fileUrl = Effect.fnUntraced(function* (
  source: string,
  cwd: string,
): Effect.fn.Return<URL, ParseError, Path.Path> {
  const path = yield* Path.Path;
  const value = source.trim();

  if (!path.isAbsolute(value) && !cwd.startsWith("file:")) {
    return yield* Effect.try({ try: () => new URL(value, cwd), catch: parseFailure });
  }

  const directory = path.isAbsolute(value) ? "" : yield* filePath(new URL(cwd));
  return yield* path.toFileUrl(path.resolve(directory, value)).pipe(Effect.mapError(parseFailure));
});

const resolveCwd = Effect.fnUntraced(function* (path: Path.Path, cwd: LoadOptions["cwd"]) {
  if (cwd instanceof URL) {
    return cwd.href;
  }

  const directory = typeof cwd === "string" ? path.resolve(cwd) : path.resolve(".");

  return yield* path.toFileUrl(directory).pipe(
    Effect.map((url) => (url.href.endsWith("/") ? url.href : `${url.href}/`)),
    Effect.mapError(parseFailure),
  );
});

const filePath = Effect.fnUntraced(function* (
  url: URL,
): Effect.fn.Return<string, ParseError, Path.Path> {
  const path = yield* Path.Path;
  return yield* path.fromFileUrl(url).pipe(Effect.mapError(parseFailure));
});

const readReadable = Effect.fnUntraced(function* (source: Readable) {
  return yield* NodeStream.fromReadable({
    evaluate: () => source,
    onError: parseFailure,
  }).pipe(
    Stream.decodeText,
    Stream.mkString,
    Effect.map((text) => text.trim()),
  );
});

const documentObject = Schema.Record(Schema.String, Schema.Unknown);

const requireDocument = Effect.fnUntraced(function* (
  value: unknown,
): Effect.fn.Return<Record<string, unknown>, InvalidSource> {
  return yield* Schema.decodeUnknownEffect(documentObject)(value).pipe(
    Effect.mapError(
      () =>
        new InvalidSource({
          message: `Expected an OpenAPI document object. Got ${valueKind(value)}`,
        }),
    ),
  );
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
