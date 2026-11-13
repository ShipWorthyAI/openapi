import { Schema } from "effect";

export class TypegenError extends Schema.TaggedError<
  TypegenError,
  { readonly brand: unique symbol }
>()("TypegenError", {
  message: Schema.String,
}) {}
