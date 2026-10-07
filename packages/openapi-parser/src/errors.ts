import { Match, Schema } from "effect";

export type JSONParserErrorType =
  | "EUNKNOWN"
  | "EPARSER"
  | "EUNMATCHEDPARSER"
  | "ETIMEOUT"
  | "ERESOLVER"
  | "EUNMATCHEDRESOLVER"
  | "EMISSINGPOINTER"
  | "EINVALIDPOINTER";

export class JSONParserError extends Error {
  readonly code: JSONParserErrorType = "EUNKNOWN";
  source: string | undefined;
  path: Array<string | number> | null = null;

  constructor(message: string, source?: string) {
    super(message);
    this.name = "JSONParserError";
    this.source = source;
  }

  get footprint(): string {
    return `${JSON.stringify(this.path)}+${this.source}+${this.code}+${this.message}`;
  }
}

export class ParserError extends JSONParserError {
  override code: JSONParserErrorType = "EPARSER";
  override name = "ParserError";

  constructor(message: string, source?: string) {
    super(`Error parsing ${source}: ${message}`, source);
  }
}

export class UnmatchedParserError extends JSONParserError {
  override code: JSONParserErrorType = "EUNMATCHEDPARSER";
  override name = "UnmatchedParserError";

  constructor(source: string) {
    super(`Could not find parser for "${source}"`, source);
  }
}

export class ResolverError extends JSONParserError {
  override code: JSONParserErrorType = "ERESOLVER";
  override name = "ResolverError";
  ioErrorCode?: string;

  constructor(cause: Error, source?: string) {
    super(cause.message || `Error reading file "${source}"`, source);

    if ("code" in cause && (typeof cause.code === "string" || typeof cause.code === "number")) {
      this.ioErrorCode = String(cause.code);
    }
  }
}

export class UnmatchedResolverError extends JSONParserError {
  override code: JSONParserErrorType = "EUNMATCHEDRESOLVER";
  override name = "UnmatchedResolverError";

  constructor(source: string) {
    super(`Could not find resolver for "${source}"`, source);
  }
}

export class MissingPointerError extends JSONParserError {
  override code: JSONParserErrorType = "EMISSINGPOINTER";
  override name = "MissingPointerError";
  targetToken: string;
  targetRef: string;
  targetFound: string;
  parentPath: string;

  constructor(token: string, source: string, targetRef = "", targetFound = "", parentPath = "") {
    const hash = source.includes("#") ? source.slice(source.indexOf("#")) : source;
    super(`Missing $ref pointer "${hash}". Token "${token}" does not exist.`, source);
    this.targetToken = token;
    this.targetRef = targetRef;
    this.targetFound = targetFound;
    this.parentPath = parentPath;
  }
}

export class InvalidPointerError extends JSONParserError {
  override code: JSONParserErrorType = "EINVALIDPOINTER";
  override name = "InvalidPointerError";

  constructor(pointer: string, source?: string) {
    super(`Invalid $ref pointer "${pointer}". Pointers must begin with "#/"`, source);
  }
}

export class TimeoutError extends JSONParserError {
  override code: JSONParserErrorType = "ETIMEOUT";
  override name = "TimeoutError";

  constructor(timeout: number) {
    super(`Dereferencing timeout reached: ${timeout}ms`);
  }
}

export class JSONParserErrorGroup extends Error {
  readonly errors: JSONParserError[];

  constructor(source: string, errors: JSONParserError[]) {
    super(
      `${errors.length} error${errors.length === 1 ? "" : "s"} occurred while reading '${source}'`,
    );

    this.name = "JSONParserErrorGroup";
    this.errors = errors;
  }
}

export function isHandledError(error: unknown): error is JSONParserError | JSONParserErrorGroup {
  return error instanceof JSONParserError || error instanceof JSONParserErrorGroup;
}

const failureFields = {
  message: Schema.String,
  source: Schema.String,
};

export class ParserFailure extends Schema.TaggedError<ParserFailure>()("ParserFailure", {
  ...failureFields,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class ResolverFailure extends Schema.TaggedError<ResolverFailure>()("ResolverFailure", {
  ...failureFields,
  ioErrorCode: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class UnmatchedParserFailure extends Schema.TaggedError<UnmatchedParserFailure>()(
  "UnmatchedParserFailure",
  failureFields,
) {}

export class UnmatchedResolverFailure extends Schema.TaggedError<UnmatchedResolverFailure>()(
  "UnmatchedResolverFailure",
  failureFields,
) {}

export class MissingPointerFailure extends Schema.TaggedError<MissingPointerFailure>()(
  "MissingPointerFailure",
  {
    ...failureFields,
    token: Schema.String,
    targetRef: Schema.String,
    targetFound: Schema.String,
    parentPath: Schema.String,
  },
) {}

export class InvalidPointerFailure extends Schema.TaggedError<InvalidPointerFailure>()(
  "InvalidPointerFailure",
  {
    ...failureFields,
    pointer: Schema.String,
  },
) {}

export class CircularAliasFailure extends Schema.TaggedError<CircularAliasFailure>()(
  "CircularAliasFailure",
  {
    message: Schema.String,
    definition: Schema.String,
  },
) {}

export class BundleFailure extends Schema.TaggedError<BundleFailure>()("BundleFailure", {
  message: Schema.String,
}) {}

export class TimeoutFailure extends Schema.TaggedError<TimeoutFailure>()("TimeoutFailure", {
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

export class GroupFailure extends Schema.TaggedError<GroupFailure>()("GroupFailure", {
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

export function isTaggedFailure(cause: unknown): cause is TaggedFailure {
  return taggedFailures.some((Failure) => cause instanceof Failure);
}

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

export function toPublicError(error: TaggedFailure): Error {
  return Match.value(error).pipe(
    Match.tagsExhaustive({
      ParserFailure: (failure) => new ParserError(failure.message, failure.source),
      ResolverFailure: (failure) => {
        const publicError = new ResolverError(
          Object.assign(new Error(failure.message), { code: failure.ioErrorCode }),
          failure.source,
        );

        if (failure.ioErrorCode) publicError.ioErrorCode = failure.ioErrorCode;
        return publicError;
      },
      UnmatchedParserFailure: (failure) => new UnmatchedParserError(failure.source),
      UnmatchedResolverFailure: (failure) => new UnmatchedResolverError(failure.source),
      MissingPointerFailure: (failure) =>
        new MissingPointerError(
          failure.token,
          failure.source,
          failure.targetRef,
          failure.targetFound,
          failure.parentPath,
        ),
      InvalidPointerFailure: (failure) => new InvalidPointerError(failure.pointer, failure.source),
      CircularAliasFailure: (failure) => new ReferenceError(failure.message),
      BundleFailure: (failure) => new Error(failure.message),
      TimeoutFailure: (failure) => new TimeoutError(failure.timeout),
      GroupFailure: (failure) => {
        const errors = failure.errors.map((item) => {
          const publicError = toPublicError(item);

          return publicError instanceof JSONParserError
            ? publicError
            : new JSONParserError(publicError.message);
        });

        return errors.length === 1 ? errors[0]! : new JSONParserErrorGroup(failure.source, errors);
      },
    }),
  );
}

export class EmptySource extends Schema.TaggedError<EmptySource>()("EmptySource", {
  message: Schema.String,
}) {}

export class InvalidSource extends Schema.TaggedError<InvalidSource>()("InvalidSource", {
  message: Schema.String,
}) {}

export class UnsupportedVersion extends Schema.TaggedError<UnsupportedVersion>()(
  "UnsupportedVersion",
  {
    message: Schema.String,
  },
) {}

export class ParseError extends Schema.TaggedError<ParseError>()("ParseError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export type LoadError = EmptySource | InvalidSource | UnsupportedVersion | ParseError;
