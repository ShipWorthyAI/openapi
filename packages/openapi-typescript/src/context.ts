import type { ParsedService } from "@shipworthy/openapi-transformer";
import { Context, Effect, Predicate, Schema } from "effect";
import { TypegenError } from "./errors.ts";
import { resolveRef, scanDiscriminators } from "./lib/utils.ts";
import type { GlobalContext, OpenAPITSOptions } from "./types.ts";

/** Options and shared state for one run of the transforms. */
export class TypegenContext extends Context.Service<TypegenContext, GlobalContext>()(
  "@shipworthy/openapi-typescript/TypegenContext",
) {}

/** A boolean option that defaults to `fallback` when it is left out. */
function flag(fallback: boolean) {
  return Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(fallback)));
}

function hook<F extends (...args: never[]) => unknown>() {
  return Schema.optional(Schema.declare<F>((value): value is F => Predicate.isFunction(value)));
}

/** The options the plugin accepts. See `OpenAPITSOptions` for what each one does. */
const PluginOptions = Schema.Struct({
  arrayLength: flag(true),
  transform: hook<NonNullable<OpenAPITSOptions["transform"]>>(),
  postTransform: hook<NonNullable<OpenAPITSOptions["postTransform"]>>(),
  transformProperty: hook<NonNullable<OpenAPITSOptions["transformProperty"]>>(),
  silent: flag(false),
  exportType: flag(false),
  enum: flag(false),
  enumValues: flag(false),
  conditionalEnums: flag(false),
  dedupeEnums: flag(false),
  rootTypes: flag(false),
  inject: Schema.optionalKey(Schema.String),
  readWriteMarkers: flag(false),
});

/** Decode plugin options and build the context for transforming `model`. */
export const makeTypegenContext = Effect.fnUntraced(function* (
  model: ParsedService,
  raw: Readonly<Record<string, unknown>>,
): Effect.fn.Return<GlobalContext, TypegenError> {
  const { transform, postTransform, transformProperty, ...options } = yield* Schema.decodeEffect(
    PluginOptions,
  )(raw, { onExcessProperty: "error" }).pipe(
    Effect.mapError((cause) => new TypegenError({ message: cause.message })),
  );

  const discriminators = yield* scanDiscriminators(model, { silent: options.silent });

  return {
    ...options,
    discriminators,
    injectFooter: [],
    transform,
    postTransform,
    transformProperty,
    resolve($ref) {
      return resolveRef(model, $ref, { silent: options.silent });
    },
  };
});
