import { Schema } from "effect";

export class ZodGenerationError extends Schema.TaggedError<ZodGenerationError>()(
  "ZodGenerationError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}
