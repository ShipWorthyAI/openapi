import { Effect, type FileSystem, Predicate, Schema } from "effect";
import type { HttpClient } from "effect/http";
import type { TaggedFailure } from "./errors.ts";

export interface FileInfo {
  url: string;
  extension: string;
  data?: Uint8Array | string;
}

function callback<F extends (...args: never[]) => unknown>() {
  return Schema.declare<F>((value): value is F => Predicate.isFunction(value));
}

const httpResolverOptions = Schema.Struct({
  headers: Schema.optional(
    Schema.Union([Schema.Record(Schema.String, Schema.String), Schema.Null]),
  ),
  timeout: Schema.optional(Schema.Finite),
  redirects: Schema.optional(Schema.Finite),
  withCredentials: Schema.optional(Schema.Boolean),
  safeUrlResolver: Schema.optional(Schema.Boolean),
  allowedOrigins: Schema.optional(Schema.Array(Schema.String)),
});
export type HttpResolverOptions = typeof httpResolverOptions.Type;

const resolverPluginShape = Schema.Struct({
  order: Schema.optional(Schema.Finite),
  canRead: callback<(file: FileInfo) => boolean>(),
  read: callback<(file: FileInfo) => Uint8Array | string | Promise<Uint8Array | string>>(),
});
export type ResolverPlugin = typeof resolverPluginShape.Type;
const resolverPlugin = Schema.declare<ResolverPlugin>(Schema.is(resolverPluginShape));

const parserPluginShape = Schema.Struct({
  order: Schema.optional(Schema.Finite),
  canParse: callback<(file: FileInfo) => boolean>(),
  parse: callback<(file: FileInfo) => unknown>(),
});
export type ParserPlugin = typeof parserPluginShape.Type;
const parserPlugin = Schema.declare<ParserPlugin>(Schema.is(parserPluginShape));

const bundleHooksShape = Schema.Struct({
  onBundle:
    Schema.optional(callback<(ref: string, value: unknown, parent: object, key: string) => void>()),
});
export type BundleHooks = typeof bundleHooksShape.Type;
const bundleHooks = Schema.declare<BundleHooks>(Schema.is(bundleHooksShape));

const dereferenceHooksShape = Schema.Struct({
  onDereference:
    Schema.optional(
      callback<(path: string, value: unknown, parent: object, key: string | number) => void>(),
    ),
  onCircular: Schema.optional(callback<(path: string) => void>()),
});
export type DereferenceHooks = typeof dereferenceHooksShape.Type;
const dereferenceHooks = Schema.declare<DereferenceHooks>(Schema.is(dereferenceHooksShape));

export const Options = Schema.Struct({
  continueOnError: Schema.optional(Schema.Boolean),
  keepUrlRefs: Schema.optional(Schema.Boolean),
  resolve: Schema.optional(
    Schema.Struct({
      file: Schema.optional(Schema.Boolean),
      http: Schema.optional(Schema.Union([Schema.Boolean, httpResolverOptions])),
    }),
  ),
  parse: Schema.optional(
    Schema.Struct({
      json: Schema.optional(Schema.Boolean),
      yaml: Schema.optional(Schema.Boolean),
    }),
  ),
  resolvers: Schema.optional(Schema.Array(resolverPlugin)),
  parsers: Schema.optional(Schema.Array(parserPlugin)),
  bundle: Schema.optional(bundleHooks),
  dereference: Schema.optional(dereferenceHooks),
});
export type Options = typeof Options.Type;

export interface EffectPlugin<A> {
  order: number;
  can: (file: FileInfo) => boolean;
  run: (
    file: FileInfo,
  ) => Effect.Effect<A, TaggedFailure, FileSystem.FileSystem | HttpClient.HttpClient>;
}

export function promisePlugin<A>(
  order: number,
  can: (file: FileInfo) => boolean,
  run: (file: FileInfo) => A | Promise<A>,
  onError: (cause: unknown, file: FileInfo) => TaggedFailure,
): EffectPlugin<A> {
  return {
    order,
    can,
    run(file) {
      return Effect.tryPromise({
        try: () => Promise.resolve(run(file)),
        catch: (cause) => onError(cause, file),
      });
    },
  };
}
