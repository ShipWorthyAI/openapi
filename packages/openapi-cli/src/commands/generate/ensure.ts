import { fileURLToPath } from "node:url";
import { Crypto, Effect, FileSystem, Option, Path, Schema } from "effect";
import { CliError } from "effect/cli";
import { HttpClient } from "effect/http";
import { defaultTypeFlags } from "./plugins/typescript/flags";
import { renderTypescript } from "./plugins/typescript/plugin";

const Stamp = Schema.Struct({
  input: Schema.String,
  hash: Schema.String,
});

export const ensureDependencies = Effect.fn("ensureDependencies")(function* (
  dependencies: readonly string[],
  target: { readonly source: URL; readonly directory: string; readonly started: number },
) {
  for (const dependency of dependencies) {
    if (dependency === "typescript") {
      yield* ensureTypescript(target);
      continue;
    }

    return yield* new CliError.UserError({
      cause: `Unknown generator dependency: ${dependency}.`,
    });
  }
});

const ensureTypescript = Effect.fn("ensureTypescript")(function* (target: {
  readonly source: URL;
  readonly directory: string;
  readonly started: number;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const typesPath = path.join(target.directory, "types.ts");
  const stampPath = path.join(target.directory, "types.stamp.json");
  const text = yield* readInputText(target.source);
  const hash = yield* sha256(text);
  const stamp = yield* readStamp(stampPath);
  const types = yield* fs.readFileString(typesPath).pipe(Effect.option);

  if (Option.isSome(types) && stamp?.input === target.source.href && stamp.hash === hash) return;

  yield* renderTypescript({
    source: target.source,
    outputPath: typesPath,
    flags: defaultTypeFlags,
    check: false,
    label: target.source.href,
    outputLabel: typesPath,
    started: target.started,
  });

  yield* fs.makeDirectory(target.directory, { recursive: true });

  yield* fs.writeFileString(
    stampPath,
    `${JSON.stringify({ input: target.source.href, hash }, null, 2)}\n`,
  );
});

const readStamp = Effect.fn("readStamp")(function* (stampPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(stampPath).pipe(Effect.option);
  if (Option.isNone(text)) return undefined;

  const parsed = yield* Schema.decodeEffect(Schema.fromJsonString(Stamp))(text.value).pipe(
    Effect.option,
  );

  if (Option.isNone(parsed)) return undefined;

  return parsed.value;
});

const readInputText = Effect.fn("readInputText")(function* (source: URL) {
  if (source.protocol === "file:") {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(fileURLToPath(source));
  }

  const http = yield* HttpClient.HttpClient;
  const client = HttpClient.filterStatusOk(http);
  const response = yield* client.get(source.href);

  return yield* response.text;
});

const sha256 = Effect.fn("sha256")(function* (text: string) {
  const crypto = yield* Crypto.Crypto;
  const digest = yield* crypto.digest("SHA-256", new TextEncoder().encode(text));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
});
