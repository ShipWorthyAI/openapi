#!/usr/bin/env bun
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Array, Cause, Console, Effect, FileSystem, pipe, Schema } from "effect";

const manifestPath = "package.json";
const backupPath = "node_modules/.package.dev.json";
const registryFields = new Set(["access", "registry", "tag", "provenance"]);

const Manifest = Schema.StructWithRest(
  Schema.Struct({ publishConfig: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)) }),
  [Schema.Record(Schema.String, Schema.Json)],
);

const ManifestFromJson = Schema.fromJsonString(Manifest);
const JsonObjectFromString = Schema.fromJsonString(Schema.JsonObject, { space: 2 });

class ManifestError extends Schema.TaggedError<ManifestError>()("ManifestError", {
  message: Schema.String,
}) {}

const prepack = Effect.fn("publishManifest.prepack")(function* () {
  const fs = yield* FileSystem.FileSystem;

  if (yield* fs.exists(backupPath)) {
    return yield* new ManifestError({
      message: `${backupPath} exists. Run postpack to restore the development manifest first.`,
    });
  }

  const source = yield* fs.readFileString(manifestPath);
  const manifest = yield* Schema.decodeEffect(ManifestFromJson)(source);

  const entries = pipe(
    manifest,
    Object.entries,
    Array.filter(([key]) => key !== "publishConfig"),
  );

  const config = Object.entries(manifest.publishConfig ?? {});

  const registry = pipe(
    config,
    Array.filter(([key]) => registryFields.has(key)),
    Object.fromEntries,
  );

  const published = pipe(
    [
      ...entries,
      ...pipe(
        config,
        Array.filter(([key]) => !registryFields.has(key)),
      ),
      ...(Object.keys(registry).length > 0 ? [["publishConfig", registry] as const] : []),
    ],
    Object.fromEntries,
  );

  const text = yield* Schema.encodeEffect(JsonObjectFromString)(published);

  yield* fs.makeDirectory("node_modules", { recursive: true });
  yield* fs.writeFileString(backupPath, source, { flag: "wx" });

  yield* fs
    .writeFileString(manifestPath, `${text}\n`)
    .pipe(Effect.tapError(() => fs.rename(backupPath, manifestPath)));
});

const postpack = Effect.fn("publishManifest.postpack")(function* () {
  const fs = yield* FileSystem.FileSystem;

  if (yield* fs.exists(backupPath)) {
    yield* fs.rename(backupPath, manifestPath);
  }
});

Effect.gen(function* () {
  const input = process.argv[2];

  const command = yield* Schema.decodeUnknownEffect(Schema.Literals(["prepack", "postpack"]))(
    input,
  ).pipe(
    Effect.mapError(
      () =>
        new ManifestError({
          message: `Unknown command ${String(input)}. Use prepack or postpack.`,
        }),
    ),
  );

  if (command === "prepack") yield* prepack();
  else yield* postpack();
}).pipe(
  Effect.tapCause((cause) => Console.error(Cause.pretty(cause))),
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain({ disableErrorReporting: true }),
);
