import * as NodeModule from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Array, Effect, Option, Predicate, Schema } from "effect";
import { ZodGenerationError } from "./errors.ts";

const requiredVersion = "4.6.7";

const PackageJson = Schema.Struct({
  version: Schema.String,
  exports: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

function isMissingPackage(cause: unknown): boolean {
  return (
    Predicate.isObject(cause) &&
    (cause.code === "ERR_MODULE_NOT_FOUND" || cause.code === "MODULE_NOT_FOUND")
  );
}

const findZodPackage = Effect.fnUntraced(function* (
  from: string,
): Effect.fn.Return<string | undefined, ZodGenerationError> {
  // Only an installed package can be imported by the generated module. Bun's
  // resolver may otherwise auto-install a version from its global cache.
  const resolver = yield* Effect.try({
    try: () => NodeModule.createRequire(from),
    catch: (cause) =>
      new ZodGenerationError({ message: `#: Cannot resolve zod from ${from}`, cause }),
  });

  const start = yield* Effect.try({
    try: () => new URL(".", from),
    catch: (cause) =>
      new ZodGenerationError({ message: `#: Cannot resolve zod from ${from}`, cause }),
  });

  const candidates = Array.unfold(Option.some(start), (directory) =>
    Option.map(directory, (url) => {
      const parent = new URL("..", url);

      return [
        new URL("node_modules/zod/package.json", url),
        parent.href === url.href ? Option.none() : Option.some(parent),
      ] as const;
    }),
  );

  const found = yield* Effect.forEach(candidates, (candidate) =>
    Effect.try({
      try: () => resolver.resolve(fileURLToPath(candidate)),
      catch: (cause) =>
        new ZodGenerationError({ message: `#: Cannot resolve zod from ${from}`, cause }),
    }).pipe(
      Effect.catchIf(
        (error) => isMissingPackage(error.cause),
        () => Effect.void,
      ),
    ),
  );

  return Option.getOrUndefined(Array.findFirst(found, Predicate.isString));
});

/** Resolve the package visible to an ESM output file, then load its import entry. */
export const loadZod = Effect.fnUntraced(function* (
  outputPath?: string,
): Effect.fn.Return<typeof import("zod"), ZodGenerationError> {
  const outputUrl = outputPath
    ? yield* Effect.try({
        try: () => pathToFileURL(outputPath).href,
        catch: (cause) =>
          new ZodGenerationError({ message: `#: Cannot resolve zod from ${outputPath}`, cause }),
      })
    : undefined;

  const outputPackage = outputUrl ? yield* findZodPackage(outputUrl) : undefined;
  const manifestPath = outputPackage ?? (yield* findZodPackage(import.meta.url));
  if (!manifestPath)
    return yield* new ZodGenerationError({
      message: `#: Cannot resolve zod from ${outputPath ?? import.meta.url} or the generator`,
    });

  const rawManifest = yield* Effect.try({
    try: () => NodeModule.createRequire(manifestPath)(manifestPath) as unknown,
    catch: (cause) =>
      new ZodGenerationError({ message: `#: Cannot read zod package at ${manifestPath}`, cause }),
  });

  const manifest = yield* Schema.decodeUnknownEffect(PackageJson)(rawManifest).pipe(
    Effect.mapError(
      (cause) =>
        new ZodGenerationError({ message: `#: Cannot read zod version at ${manifestPath}`, cause }),
    ),
  );

  if (manifest.version !== requiredVersion)
    return yield* new ZodGenerationError({
      message: `#: Found zod@${manifest.version} at ${manifestPath} (resolved from ${outputPackage ? outputPath : import.meta.url}); require zod@${requiredVersion}`,
    });

  const rootExport = manifest.exports?.["."];
  const importEntry = Predicate.isObject(rootExport) ? rootExport.import : undefined;
  if (!Predicate.isString(importEntry) || !importEntry.startsWith("./"))
    return yield* new ZodGenerationError({
      message: `#: Cannot resolve zod import entry at ${manifestPath}`,
    });

  const entry = yield* Effect.try({
    try: () => fileURLToPath(new URL(importEntry, pathToFileURL(manifestPath))),
    catch: (cause) =>
      new ZodGenerationError({
        message: `#: Cannot resolve zod import entry at ${manifestPath}`,
        cause,
      }),
  });

  const loaded = yield* Effect.try({
    try: () => NodeModule.createRequire(manifestPath)(entry) as unknown,
    catch: (cause) =>
      new ZodGenerationError({ message: `#: Cannot import zod at ${entry}`, cause }),
  });

  if (
    !Predicate.isObject(loaded) ||
    !Predicate.isFunction(loaded.fromJSONSchema) ||
    !Predicate.isFunction(loaded.compile)
  )
    return yield* new ZodGenerationError({
      message: `#: zod@${manifest.version} at ${entry} does not expose fromJSONSchema and compile`,
    });

  return loaded as typeof import("zod");
});
