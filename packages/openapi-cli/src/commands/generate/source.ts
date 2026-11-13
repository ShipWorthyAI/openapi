import { fileURLToPath } from "node:url";
import { Effect, FileSystem, Stdio, Stream } from "effect";
import { HttpClient } from "effect/http";

export const readStdin = Effect.fn("readStdin")(function* () {
  const stdio = yield* Stdio.Stdio;
  return yield* stdio.stdin.pipe(Stream.decodeText(), Stream.mkString);
});

/** The schema text at `source`, read once to stamp generated files. */
export const readSource = Effect.fn("readSource")(function* (source: URL) {
  if (source.protocol === "file:") {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(fileURLToPath(source));
  }

  const http = yield* HttpClient.HttpClient;
  const client = HttpClient.filterStatusOk(http);
  const response = yield* client.get(source.href);

  return yield* response.text;
});
