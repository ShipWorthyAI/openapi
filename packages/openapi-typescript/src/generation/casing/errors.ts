import { Schema } from "effect";

export class CaseMappingGenerationError extends Schema.TaggedError<CaseMappingGenerationError>()(
  "CaseMappingGenerationError",
  { message: Schema.String },
) {}
