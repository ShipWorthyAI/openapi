import type { Generator } from "./generator.ts";
import { Context, Effect, Predicate, Schema } from "effect";
import { InvalidPlugin, MissingPlugin } from "./errors.ts";

export const ModuleLoader = Context.Reference<{
  readonly load: (specifier: string) => Promise<unknown>;
}>("@shipworthy/openapi-generator/plugins/ModuleLoader", {
  defaultValue: () => ({ load: (specifier) => import(specifier) }),
});

const generatorShape = Schema.Struct({
  id: Schema.String,
  generate: Schema.declare<Generator<unknown>["generate"]>(
    (value): value is Generator<unknown>["generate"] => Predicate.isFunction(value),
  ),
});

// Keep plugin identity and prototype methods while validating its callable interface.
const generatorSchema = Schema.declare<Generator<unknown>>(Schema.is(generatorShape));
const moduleSchema = Schema.Record(Schema.String, Schema.Unknown);

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

  const invalid = () =>
    new InvalidPlugin({
      specifier,
      exportName,
      message: `Module ${specifier} does not export ${exportName}.`,
    });

  const module = yield* Schema.decodeUnknownEffect(moduleSchema)(loaded).pipe(
    Effect.mapError(invalid),
  );

  return yield* Schema.decodeUnknownEffect(generatorSchema)(module[exportName]).pipe(
    Effect.mapError(invalid),
  );
});
