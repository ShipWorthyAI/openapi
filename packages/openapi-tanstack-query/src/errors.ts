import { Schema } from "effect";

export class TanstackGenerationError extends Schema.TaggedError<
  TanstackGenerationError,
  { readonly brand: unique symbol }
>()("TanstackGenerationError", {
  message: Schema.String,
}) {}
