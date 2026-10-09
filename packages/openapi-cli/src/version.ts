import { Effect, FileSystem, Path, Schema } from "effect";

const PackageJson = Schema.Struct({ version: Schema.String });

export const version = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const filename = yield* path.fromFileUrl(new URL("../package.json", import.meta.url));
  const source = yield* fs.readFileString(filename);
  const manifest = yield* Schema.decodeEffect(Schema.fromJsonString(PackageJson))(source);
  return manifest.version;
});
