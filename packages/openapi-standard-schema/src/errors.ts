import { Schema } from "effect";

export class SchemaGenerationError extends Schema.TaggedError<SchemaGenerationError>()(
  "SchemaGenerationError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}
