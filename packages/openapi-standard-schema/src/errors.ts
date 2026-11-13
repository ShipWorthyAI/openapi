import { Schema } from "effect";

export class SchemaGenerationError extends Schema.TaggedError<
  SchemaGenerationError,
  { readonly brand: unique symbol }
>()("SchemaGenerationError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}
