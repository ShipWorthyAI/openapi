import { Effect, type FileSystem } from "effect";
import type { TaggedFailure } from "./errors.js";

export interface FileInfo {
  url: string;
  extension: string;
  data?: Uint8Array | string;
}

export interface ResolverPlugin {
  order?: number;
  canRead: (file: FileInfo) => boolean;
  read: (file: FileInfo) => Uint8Array | string | Promise<Uint8Array | string>;
}

export interface ParserPlugin {
  order?: number;
  canParse: (file: FileInfo) => boolean;
  parse: (file: FileInfo) => unknown | Promise<unknown>;
}

export interface HttpResolverOptions {
  headers?: Record<string, string> | null;
  timeout?: number;
  redirects?: number;
  withCredentials?: boolean;
  safeUrlResolver?: boolean;
  allowedOrigins?: string[];
}

export interface BundleHooks {
  onBundle?: (ref: string, value: unknown, parent: object, key: string) => void;
}

export interface DereferenceHooks {
  onDereference?: (path: string, value: unknown, parent: object, key: string | number) => void;
  onCircular?: (path: string) => void;
}

export interface Options {
  continueOnError?: boolean;
  keepUrlRefs?: boolean;
  resolve?: {
    file?: boolean;
    http?: boolean | HttpResolverOptions;
  };
  parse?: {
    json?: boolean;
    yaml?: boolean;
  };
  resolvers?: ResolverPlugin[];
  parsers?: ParserPlugin[];
  bundle?: BundleHooks;
  dereference?: DereferenceHooks;
}

const optionKeys = new Set([
  "continueOnError",
  "keepUrlRefs",
  "resolve",
  "parse",
  "resolvers",
  "parsers",
  "bundle",
  "dereference",
]);

export function isOptions(value: unknown): value is Options {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.keys(value).some((key) => optionKeys.has(key));
}

export interface NormalizedArguments {
  path: string;
  schema: unknown;
  options: Options;
}

export function normalizeArguments(args: unknown[]): NormalizedArguments {
  let path = "";
  let schema: unknown;
  let options: Options = {};
  if (typeof args[0] === "string") {
    path = args[0];
    if (args.length >= 3) {
      schema = args[1];
      options = isOptions(args[2]) ? args[2] : {};
    } else if (isOptions(args[1])) {
      options = args[1];
    } else {
      schema = args[1];
    }
  } else {
    schema = args[0];
    options = isOptions(args[1]) ? args[1] : {};
  }
  return { path, schema, options };
}

export interface EffectPlugin<A> {
  order: number;
  can: (file: FileInfo) => boolean;
  run: (file: FileInfo) => Effect.Effect<A, TaggedFailure, FileSystem.FileSystem>;
}

export function promisePlugin<A>(
  order: number,
  can: (file: FileInfo) => boolean,
  run: (file: FileInfo) => A | Promise<A>,
  onError: (cause: unknown) => TaggedFailure,
): EffectPlugin<A> {
  return {
    order,
    can,
    run(file) {
      return Effect.tryPromise({
        try: async () => {
          const value = run(file);
          return value instanceof Promise ? await value : value;
        },
        catch: onError,
      }) as Effect.Effect<A, TaggedFailure, FileSystem.FileSystem>;
    },
  };
}
