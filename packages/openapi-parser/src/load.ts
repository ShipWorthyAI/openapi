import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { parseYamlDocument } from "@shipworthy/openapi-ref-parser/yaml";
import { Effect, FileSystem, Path } from "effect";
import { isRecord, versionMessage, type OpenAPIDocument } from "./document.js";
import { causeMessage, EmptySource, InvalidSource, ParseError, UnsupportedVersion, type LoadError } from "./errors.js";

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

export const loadDocument = Effect.fn("openapi-parser.loadDocument")(function* (
  source: unknown,
  options?: LoadOptions,
): Effect.fn.Return<LoadedDocument, LoadError, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd =
    options?.cwd instanceof URL
      ? options.cwd.protocol === "file:"
        ? fileURLToPath(options.cwd)
        : options.cwd.href
      : typeof options?.cwd === "string"
        ? path.resolve(options.cwd)
        : path.resolve(".");
  if (source == null || source === "") return yield* new EmptySource({ text: emptyPath });
  const loaded = yield* parseSource(source, cwd, fs);
  const problem = versionMessage(loaded.document);
  if (problem) return yield* new UnsupportedVersion({ text: problem });
  return loaded;
});

const parseSource = Effect.fnUntraced(function* (
  source: unknown,
  absoluteRef: string,
  fs: FileSystem.FileSystem,
): Effect.fn.Return<LoadedDocument, LoadError, FileSystem.FileSystem | Path.Path> {
  if (source == null || source === "") return yield* new EmptySource({ text: emptySchema });
  if (source instanceof URL) {
    const ref = source.protocol === "file:" ? fileURLToPath(source) : source.href;
    const sourceText =
      source.protocol === "file:"
        ? yield* fs.readFileString(ref).pipe(Effect.mapError((cause) => new ParseError({ text: cause.message })))
        : yield* Effect.tryPromise({
            try: async () => {
              const response = await fetch(ref);
              if (!response.ok) throw new Error(`Error fetching ${ref}: ${response.status} ${response.statusText}`);
              return await response.text();
            },
            catch: (cause) => new ParseError({ text: causeMessage(cause) }),
          });
    const parsed = yield* parseText(sourceText);
    return { document: asDocument(parsed), absoluteRef: ref, sourceText };
  }
  if (source instanceof Readable) {
    const contents = yield* Effect.tryPromise({
      try: () =>
        new Promise<string>((resolve, reject) => {
          source.resume();
          source.setEncoding("utf8");
          let content = "";
          source.on("data", (chunk: string) => {
            content += chunk;
          });
          source.on("error", reject);
          source.on("end", () => resolve(content.trim()));
        }),
      catch: (cause) => new ParseError({ text: causeMessage(cause) }),
    });
    return yield* parseSource(contents, absoluteRef, fs);
  }
  if (source instanceof Buffer) return yield* parseSource(source.toString("utf8"), absoluteRef, fs);
  if (typeof source === "string") {
    if (source.startsWith("http://") || source.startsWith("https://") || source.startsWith("file://")) {
      return yield* parseSource(new URL(source), absoluteRef, fs);
    }
    const parsed = yield* parseText(source);
    return { document: asDocument(parsed), absoluteRef, sourceText: source };
  }
  if (isRecord(source)) return { document: source as OpenAPIDocument, absoluteRef };
  return yield* new InvalidSource({
    text: `Expected string, object, or Buffer. Got ${Array.isArray(source) ? "Array" : typeof source}`,
  });
});

function parseText(source: string) {
  if (source[0] === "{") {
    return Effect.try({
      try: () => JSON.parse(source) as unknown,
      catch: (cause) => new ParseError({ text: causeMessage(cause) }),
    });
  }
  return Effect.try({
    try: () => parseYamlDocument(source),
    catch: (cause) => new ParseError({ text: causeMessage(cause) }),
  });
}

function asDocument(value: unknown): OpenAPIDocument {
  return isRecord(value) ? (value as OpenAPIDocument) : ({ openapi: "" } as OpenAPIDocument);
}
