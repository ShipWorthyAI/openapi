import { Schema } from "effect";

export class TypegenError extends Schema.TaggedError<TypegenError>()("TypegenError", {
  message: Schema.String,
}) {}
