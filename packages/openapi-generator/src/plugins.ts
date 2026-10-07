import type { Generator } from "./generator.js";
import { Context, Effect, Predicate } from "effect";
import { InvalidPlugin, MissingPlugin } from "./errors.js";

export const ModuleLoader = Context.Reference<{
  readonly load: (specifier: string) => Promise<unknown>;
}>("@shipworthy/openapi-generator/plugins/ModuleLoader", {
  defaultValue: () => ({ load: (specifier) => import(specifier) }),
});

export const importPlugin = Effect.fn("importPlugin")(function* (
  specifier: string,
  exportName: string,
): Effect.fn.Return<Generator<unknown>, MissingPlugin | InvalidPlugin> {
  const loader = yield* ModuleLoader;

  const loaded = yield* Effect.tryPromise({
    try: () => loader.load(specifier),
    catch: (cause) =>
      new MissingPlugin({
        specifier,
        exportName,
        message: `Install ${specifier} to load ${exportName}.`,
        cause,
      }),
  });

  const value = Predicate.isObject(loaded) ? loaded[exportName] : undefined;

  if (
    !Predicate.hasProperty(value, "generate") ||
    !Predicate.isFunction(value.generate) ||
    !Predicate.hasProperty(value, "id")
  ) {
    return yield* new InvalidPlugin({
      specifier,
      exportName,
      message: `Module ${specifier} does not export ${exportName}.`,
    });
  }

  return value as Generator<unknown>;
});
