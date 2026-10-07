import { Schema } from "effect";

export class LintError extends Schema.Error<LintError>("LintError")({
  _tag: Schema.tag("LintError"),
  text: Schema.String,
}) {
  override get message() {
    return this.text;
  }
}

export class ResolveError extends Schema.Error<ResolveError>("ResolveError")({
  _tag: Schema.tag("ResolveError"),
  text: Schema.String,
}) {
  override get message() {
    return this.text;
  }
}

export class TransformError extends Schema.Error<TransformError>("TransformError")({
  _tag: Schema.tag("TransformError"),
  text: Schema.String,
}) {
  override get message() {
    return this.text;
  }
}

export class MissingPlugin extends Schema.Error<MissingPlugin>("MissingPlugin")({
  _tag: Schema.tag("MissingPlugin"),
  plugin: Schema.String,
  specifier: Schema.String,
}) {
  override get message() {
    return `Install ${this.specifier} to run openapi generate ${this.plugin}.`;
  }
}

export class UnknownPlugin extends Schema.Error<UnknownPlugin>("UnknownPlugin")({
  _tag: Schema.tag("UnknownPlugin"),
  text: Schema.String,
}) {
  override get message() {
    return this.text;
  }
}

export function thrownMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
