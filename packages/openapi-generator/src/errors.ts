import { Schema } from "effect";

export class ResolveError extends Schema.TaggedError<
  ResolveError,
  { readonly brand: unique symbol }
>()("ResolveError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export class TransformError extends Schema.TaggedError<
  TransformError,
  { readonly brand: unique symbol }
>()("TransformError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export class MissingPlugin extends Schema.TaggedError<
  MissingPlugin,
  { readonly brand: unique symbol }
>()("MissingPlugin", {
  specifier: Schema.String,
  exportName: Schema.String,
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export class InvalidPlugin extends Schema.TaggedError<
  InvalidPlugin,
  { readonly brand: unique symbol }
>()("InvalidPlugin", {
  specifier: Schema.String,
  exportName: Schema.String,
  message: Schema.String,
}) {}
