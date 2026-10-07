import { Schema } from "effect";

export const Diagnostic = Schema.Struct({
  code: Schema.Union([Schema.String, Schema.Finite]),
  message: Schema.String,
  path: Schema.Array(Schema.Union([Schema.String, Schema.Finite])),
});

export class LintError extends Schema.TaggedError<LintError>()("LintError", {
  message: Schema.String,
  diagnostics: Schema.Array(Diagnostic),
  cause: Schema.optional(Schema.Defect()),
}) {}
