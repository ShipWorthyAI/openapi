import { Schema } from "effect";

export class TanstackGenerationError extends Schema.TaggedError<TanstackGenerationError>()(
  "TanstackGenerationError",
  {
    message: Schema.String,
  },
) {}
