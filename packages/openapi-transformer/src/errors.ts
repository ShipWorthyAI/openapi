import { Schema } from "effect";

/** A schema position holds something that is not a schema. */
export class InvalidSchema extends Schema.TaggedError<InvalidSchema>()("InvalidSchema", {
  message: Schema.String,
}) {}
