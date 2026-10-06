import { Schema } from "effect";

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
    return `${this.path}+${this.source}+${this.code}+${this.message}`;
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
    if ("code" in cause && cause.code != null) this.ioErrorCode = String(cause.code);
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

export class ParserFailure extends Schema.TaggedError<ParserFailure>()("ParserFailure", failureFields) {}

export class ResolverFailure extends Schema.TaggedError<ResolverFailure>()("ResolverFailure", {
  ...failureFields,
  ioErrorCode: Schema.String,
}) {}

export class UnmatchedParserFailure extends Schema.TaggedError<UnmatchedParserFailure>()(
  "UnmatchedParserFailure",
  failureFields,
) {}

export class UnmatchedResolverFailure extends Schema.TaggedError<UnmatchedResolverFailure>()(
  "UnmatchedResolverFailure",
  failureFields,
) {}

export class MissingPointerFailure extends Schema.TaggedError<MissingPointerFailure>()("MissingPointerFailure", {
  ...failureFields,
  token: Schema.String,
}) {}

export class InvalidPointerFailure extends Schema.TaggedError<InvalidPointerFailure>()("InvalidPointerFailure", {
  ...failureFields,
  pointer: Schema.String,
}) {}

export class GroupFailure extends Schema.TaggedError<GroupFailure>()("GroupFailure", {
  source: Schema.String,
  messages: Schema.String,
}) {}

export type TaggedFailure =
  | ParserFailure
  | ResolverFailure
  | UnmatchedParserFailure
  | UnmatchedResolverFailure
  | MissingPointerFailure
  | InvalidPointerFailure
  | GroupFailure;

function tagOf(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string") {
    return error._tag;
  }
  return undefined;
}

export function toPublicError(error: unknown, grouped: JSONParserError[] = []): Error {
  if (error instanceof Error && tagOf(error) === undefined) return error;
  switch (tagOf(error)) {
    case "ParserFailure": {
      const failure = error as ParserFailure;
      return new ParserError(failure.message, failure.source);
    }
    case "ResolverFailure": {
      const failure = error as ResolverFailure;
      const publicError = new ResolverError(Object.assign(new Error(failure.message), { code: failure.ioErrorCode || undefined }), failure.source);
      if (failure.ioErrorCode) publicError.ioErrorCode = failure.ioErrorCode;
      return publicError;
    }
    case "UnmatchedParserFailure":
      return new UnmatchedParserError((error as UnmatchedParserFailure).source);
    case "UnmatchedResolverFailure":
      return new UnmatchedResolverError((error as UnmatchedResolverFailure).source);
    case "MissingPointerFailure": {
      const failure = error as MissingPointerFailure;
      return new MissingPointerError(failure.token, failure.source);
    }
    case "InvalidPointerFailure": {
      const failure = error as InvalidPointerFailure;
      return new InvalidPointerError(failure.pointer, failure.source);
    }
    case "GroupFailure": {
      const failure = error as GroupFailure;
      const errors = grouped.length > 0 ? grouped : [new JSONParserError(failure.messages, failure.source)];
      return errors.length === 1 ? errors[0]! : new JSONParserErrorGroup(failure.source, errors);
    }
    default:
      return error instanceof Error ? error : new JSONParserError(String(error));
  }
}
