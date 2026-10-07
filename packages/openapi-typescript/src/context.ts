import type { ParsedService } from "@shipworthy/openapi-transformer";
import { Context, Effect, Predicate, Schema } from "effect";
import { TypegenError } from "./errors.js";
import { resolveRef, scanDiscriminators } from "./lib/utils.js";
import type { GlobalContext } from "./types.js";

/** Options and shared state for one run of the transforms. */
export class TypegenContext extends Context.Service<TypegenContext, GlobalContext>()(
  "@shipworthy/openapi-typescript/TypegenContext",
) {}

/** A boolean option that defaults to `fallback` when it is left out. */
function flag(fallback: boolean) {
  return Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(fallback)));
}

const hook = Schema.optionalKey(Schema.Unknown);

/** The options the plugin accepts. See `OpenAPITSOptions` for what each one does. */
const PluginOptions = Schema.Struct({
  additionalProperties: flag(false),
  alphabetize: flag(false),
  arrayLength: flag(false),
  emptyObjectsUnknown: flag(false),
  cwd: Schema.optionalKey(Schema.Unknown),
  defaultNonNullable: flag(true),
  excludeDeprecated: flag(false),
  transform: hook,
  postTransform: hook,
  transformProperty: hook,
  immutable: flag(false),
  silent: flag(false),
  version: Schema.optionalKey(Schema.Finite),
  exportType: flag(false),
  enum: flag(false),
  enumValues: flag(false),
  conditionalEnums: flag(false),
  dedupeEnums: flag(false),
  pathParamsAsTypes: flag(false),
  propertiesRequiredByDefault: flag(false),
  rootTypes: flag(false),
  rootTypesNoSchemaPrefix: flag(false),
  rootTypesKeepCasing: flag(false),
  inject: Schema.optionalKey(Schema.String),
  makePathsEnum: flag(false),
  generatePathParams: flag(false),
  readWriteMarkers: flag(false),
});

/** A hook the caller passed, if it is a function. */
function callback<A>(value: unknown): A | undefined {
  return Predicate.isFunction(value) ? (value as A) : undefined;
}

/** Decode plugin options and build the context for transforming `model`. */
export const makeTypegenContext = Effect.fnUntraced(function* (
  model: ParsedService,
  raw: Readonly<Record<string, unknown>>,
): Effect.fn.Return<GlobalContext, TypegenError> {
  const {
    cwd: _cwd,
    version: _version,
    transform,
    postTransform,
    transformProperty,
    ...options
  } = yield* Schema.decodeEffect(PluginOptions)(raw).pipe(
    Effect.mapError((cause) => new TypegenError({ message: cause.message })),
  );

  return {
    ...options,
    discriminators: scanDiscriminators(model, { silent: options.silent }),
    injectFooter: [],
    transform: callback(transform),
    postTransform: callback(postTransform),
    transformProperty: callback(transformProperty),
    resolve($ref) {
      return resolveRef(model, $ref, { silent: options.silent });
    },
  };
});
