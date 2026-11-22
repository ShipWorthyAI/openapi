import { Data, Effect, FileSystem, Path, pipe, String } from "effect";
import { CliError } from "effect/cli";
import { HttpClient } from "effect/http";

export const schemaSource = Effect.fn("schemaSource")(function* (input: string) {
  if (pipe(input, String.includes("*"))) {
    return yield* new CliError.UserError({ cause: "Globbing is unsupported." });
  }

  if (/^(https?:|file:)/i.test(input)) return new URL(input);

  const path = yield* Path.Path;

  return yield* Effect.mapError(
    path.toFileUrl(path.resolve(input)),
    (cause) => new CliError.UserError({ cause }),
  );
});

export function asCliError(cause: unknown): CliError.UserError {
  if (CliError.isCliError(cause) && cause._tag === "UserError") return cause;
  return new CliError.UserError({ cause });
}

/** The text of a `file:` or `http(s):` source. Non-2xx responses fail. */
export const readSource = Effect.fn("readSource")(function* (source: URL) {
  if (source.protocol === "file:") {
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(yield* path.fromFileUrl(source));
  }

  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  return yield* client.get(source.href).pipe(Effect.flatMap((response) => response.text));
});

/** An OpenAPI document given as a file or HTTP URL, or as text read from stdin. */
export type SchemaInput = Data.TaggedEnum<{
  Url: { readonly url: URL };
  Stdin: { readonly text: string };
}>;

export const SchemaInput = Data.taggedEnum<SchemaInput>();

/** What document loaders get: the URL, which relative `$ref`s resolve against, or the text. */
export const schemaLocation = SchemaInput.$match({
  Url: ({ url }) => url,
  Stdin: ({ text }) => text,
});

/** How status lines name the input. */
export const schemaLabel = SchemaInput.$match({
  Url: ({ url }) => url.href,
  Stdin: () => "stdin",
});

/** The document text. A URL is read again; stdin text is already in hand. */
export const schemaText = SchemaInput.$match({
  Url: ({ url }) => readSource(url),
  Stdin: ({ text }) => Effect.succeed(text),
});
