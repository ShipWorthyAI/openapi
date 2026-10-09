import { Schema } from "effect";

export class OverlayError extends Schema.TaggedError<OverlayError>()("OverlayError", {
  message: Schema.String,
  action: Schema.optionalKey(Schema.Int),
  target: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(Schema.Defect()),
}) {}
