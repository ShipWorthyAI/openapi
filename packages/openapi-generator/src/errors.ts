import { Schema } from "effect";

export class ResolveError extends Schema.TaggedError<ResolveError>()("ResolveError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class TransformError extends Schema.TaggedError<TransformError>()("TransformError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export class MissingPlugin extends Schema.TaggedError<MissingPlugin>()("MissingPlugin", {
  specifier: Schema.String,
  exportName: Schema.String,
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export class InvalidPlugin extends Schema.TaggedError<InvalidPlugin>()("InvalidPlugin", {
  specifier: Schema.String,
  exportName: Schema.String,
  message: Schema.String,
}) {}
