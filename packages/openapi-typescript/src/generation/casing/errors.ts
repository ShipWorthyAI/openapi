import { Schema } from "effect";

export class CaseMappingGenerationError extends Schema.TaggedError<
  CaseMappingGenerationError,
  { readonly brand: unique symbol }
>()("CaseMappingGenerationError", { message: Schema.String }) {}
