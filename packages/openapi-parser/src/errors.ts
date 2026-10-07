import { Schema } from "effect";

export class EmptySource extends Schema.Error<EmptySource>("EmptySource")({
  _tag: Schema.tag("EmptySource"),
  text: Schema.String,
}) {
  override get message() {
    return this.text;
  }
}

export class InvalidSource extends Schema.Error<InvalidSource>("InvalidSource")({
  _tag: Schema.tag("InvalidSource"),
  text: Schema.String,
}) {
  override get message() {
    return this.text;
  }
}

export class UnsupportedVersion extends Schema.Error<UnsupportedVersion>("UnsupportedVersion")({
  _tag: Schema.tag("UnsupportedVersion"),
  text: Schema.String,
}) {
  override get message() {
    return this.text;
  }
}

export class ParseError extends Schema.Error<ParseError>("ParseError")({
  _tag: Schema.tag("ParseError"),
  text: Schema.String,
}) {
  override get message() {
    return this.text;
  }
}

export type LoadError = EmptySource | InvalidSource | UnsupportedVersion | ParseError;

export function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
