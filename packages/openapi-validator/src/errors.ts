import { Schema } from "effect";

export class LintError extends Schema.Error<LintError>("LintError")({
  _tag: Schema.tag("LintError"),
  text: Schema.String,
}) {
  override get message() {
    return this.text;
  }
}
