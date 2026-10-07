import { Schema } from "effect";

/** Preserve extensions and unrecognized fields while validating every declared field. */
export function openApiObject<const Fields extends Schema.Struct.Fields>(fields: Fields) {
  return Schema.StructWithRest(Schema.Struct(fields), [
    Schema.Record(Schema.String, Schema.Unknown),
  ]);
}

/** Patterned objects also allow specification extensions alongside their entries. */
export function openApiMap<K extends Schema.Record.Key, V extends Schema.Constraint>(
  key: K,
  value: V,
) {
  const isKey = Schema.is(key);

  return Schema.StructWithRest(Schema.Record(key, value), [
    Schema.Record(Schema.String, Schema.Unknown),
  ]).check(
    Schema.makeFilter((entries) => {
      const invalid = Object.keys(entries).find((name) => !name.startsWith("x-") && !isKey(name));
      return invalid === undefined ? undefined : `Unexpected key ${JSON.stringify(invalid)}`;
    }),
  );
}
