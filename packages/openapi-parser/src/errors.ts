import { Schema } from "effect";

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
