import { Schema } from "effect";

export class ZodGenerationError extends Schema.TaggedError<
  ZodGenerationError,
  { readonly brand: unique symbol }
>()("ZodGenerationError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}
