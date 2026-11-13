import { Schema } from "effect";

const failureFields = {
  message: Schema.String,
  source: Schema.String,
};

export class ParserFailure extends Schema.TaggedError<
  ParserFailure,
  { readonly brand: unique symbol }
>()("ParserFailure", {
  ...failureFields,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class ResolverFailure extends Schema.TaggedError<
  ResolverFailure,
  { readonly brand: unique symbol }
>()("ResolverFailure", {
  ...failureFields,
  ioErrorCode: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class UnmatchedParserFailure extends Schema.TaggedError<
  UnmatchedParserFailure,
  { readonly brand: unique symbol }
>()("UnmatchedParserFailure", failureFields) {}

export class UnmatchedResolverFailure extends Schema.TaggedError<
  UnmatchedResolverFailure,
  { readonly brand: unique symbol }
>()("UnmatchedResolverFailure", failureFields) {}

export class MissingPointerFailure extends Schema.TaggedError<
  MissingPointerFailure,
  { readonly brand: unique symbol }
>()("MissingPointerFailure", {
  ...failureFields,
  token: Schema.String,
  targetRef: Schema.String,
  targetFound: Schema.String,
  parentPath: Schema.String,
}) {}

export class InvalidPointerFailure extends Schema.TaggedError<
  InvalidPointerFailure,
  { readonly brand: unique symbol }
>()("InvalidPointerFailure", {
  ...failureFields,
  pointer: Schema.String,
}) {}

export class CircularAliasFailure extends Schema.TaggedError<
  CircularAliasFailure,
  { readonly brand: unique symbol }
>()("CircularAliasFailure", {
  message: Schema.String,
  definition: Schema.String,
}) {}

export class BundleFailure extends Schema.TaggedError<
  BundleFailure,
  { readonly brand: unique symbol }
>()("BundleFailure", {
  message: Schema.String,
}) {}

export class TimeoutFailure extends Schema.TaggedError<
  TimeoutFailure,
  { readonly brand: unique symbol }
>()("TimeoutFailure", {
  message: Schema.String,
  timeout: Schema.Finite,
}) {}

const leafFailure = Schema.Union([
  ParserFailure,
  ResolverFailure,
  UnmatchedParserFailure,
  UnmatchedResolverFailure,
  MissingPointerFailure,
  InvalidPointerFailure,
  CircularAliasFailure,
  BundleFailure,
  TimeoutFailure,
]);

export class GroupFailure extends Schema.TaggedError<
  GroupFailure,
  { readonly brand: unique symbol }
>()("GroupFailure", {
  source: Schema.String,
  message: Schema.String,
  errors: Schema.Array(leafFailure),
}) {}

export type LeafFailure = typeof leafFailure.Type;
export type TaggedFailure = LeafFailure | GroupFailure;

const taggedFailures = [
  ParserFailure,
  ResolverFailure,
  UnmatchedParserFailure,
  UnmatchedResolverFailure,
  MissingPointerFailure,
  InvalidPointerFailure,
  CircularAliasFailure,
  BundleFailure,
  TimeoutFailure,
  GroupFailure,
] as const;

export const isTaggedFailure = Schema.is(Schema.Union(taggedFailures));

export function isLeafFailure(cause: TaggedFailure): cause is LeafFailure {
  return cause._tag !== "GroupFailure";
}

export function nodeErrorCode(cause: unknown): string | undefined {
  const code = errorCode(cause);
  if (code) return code;

  if (typeof cause === "object" && cause !== null && "cause" in cause)
    return errorCode(cause.cause);

  return undefined;
}

function errorCode(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return undefined;
  const { code } = cause;
  if (typeof code === "string") return code.length > 0 ? code : undefined;
  if (typeof code === "number" && Number.isFinite(code)) return String(code);
  return undefined;
}

export function missingPointerFailure(
  token: string,
  source: string,
  targetRef = "",
  targetFound = "",
  parentPath = "",
): MissingPointerFailure {
  const hash = source.includes("#") ? source.slice(source.indexOf("#")) : source;

  return new MissingPointerFailure({
    message: `Missing $ref pointer "${hash}". Token "${token}" does not exist.`,
    source,
    token,
    targetRef,
    targetFound,
    parentPath,
  });
}

export function invalidPointerFailure(pointer: string, source = pointer): InvalidPointerFailure {
  return new InvalidPointerFailure({
    message: `Invalid $ref pointer "${pointer}". Pointers must begin with "#/"`,
    source,
    pointer,
  });
}

export function circularAliasFailure(definition: string): CircularAliasFailure {
  return new CircularAliasFailure({
    message: `Definition ${JSON.stringify(definition)} is a circular alias.`,
    definition,
  });
}

export function bundleFailure(message: string): BundleFailure {
  return new BundleFailure({ message });
}

export function timeoutFailure(timeout: number): TimeoutFailure {
  return new TimeoutFailure({
    message: `Dereferencing timeout reached: ${timeout}ms`,
    timeout,
  });
}

export function groupFailure(source: string, errors: ReadonlyArray<LeafFailure>): GroupFailure {
  return new GroupFailure({
    source,
    message: `${errors.length} error${errors.length === 1 ? "" : "s"} occurred while reading '${source}'`,
    errors: [...errors],
  });
}

export function syncFailure(cause: unknown): TaggedFailure {
  if (isTaggedFailure(cause)) return cause;

  return new BundleFailure({
    message: cause instanceof Error ? cause.message : String(cause),
  });
}

export class EmptySource extends Schema.TaggedError<
  EmptySource,
  { readonly brand: unique symbol }
>()("EmptySource", {
  message: Schema.String,
}) {}

export class InvalidSource extends Schema.TaggedError<
  InvalidSource,
  { readonly brand: unique symbol }
>()("InvalidSource", {
  message: Schema.String,
}) {}

export class UnsupportedVersion extends Schema.TaggedError<
  UnsupportedVersion,
  { readonly brand: unique symbol }
>()("UnsupportedVersion", {
  message: Schema.String,
}) {}

export class ParseError extends Schema.TaggedError<ParseError, { readonly brand: unique symbol }>()(
  "ParseError",
  {
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export type LoadError = EmptySource | InvalidSource | UnsupportedVersion | ParseError;
