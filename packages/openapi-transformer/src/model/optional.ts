import { Option, Predicate, Schema, SchemaGetter } from "effect";

/**
 * A field that may be absent. Decoding also accepts `undefined` and leaves the key out, so a
 * parser can pass a value it may not have.
 */
export function optionalField<S extends Schema.Top>(
  schema: S,
): Schema.decodeTo<Schema.optionalKey<Schema.toType<S>>, Schema.optional<S>> {
  return Schema.decodeTo<Schema.optionalKey<Schema.toType<S>>, Schema.optional<S>>(
    Schema.optionalKey(Schema.toType(schema)),
    {
      decode: SchemaGetter.transformOptional(Option.filter(Predicate.isNotUndefined)),
      encode: SchemaGetter.passthrough(),
    },
  )(Schema.optional(schema));
}

export const optionalString = optionalField(Schema.String);
export const optionalBoolean = optionalField(Schema.Boolean);
