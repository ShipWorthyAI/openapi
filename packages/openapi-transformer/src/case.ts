import { Array, Predicate, Record, Schema, String } from "effect";
import { ParsedSchema } from "./model/schema.ts";

const isParsedSchema = Schema.is(ParsedSchema);
const snakeCase = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

export function propertyName(name: string, camelCase: boolean): string {
  return camelCase && snakeCase.test(name) ? String.snakeToCamel(name) : name;
}

export function collidingProperties(
  names: readonly string[],
  camelCase: boolean,
): readonly [string, string] | undefined {
  if (!camelCase) return undefined;

  const seen = new Map<string, string>();

  return Array.reduce(
    names,
    undefined as readonly [string, string] | undefined,
    (collision, name) => {
      if (collision) return collision;

      const transformed = propertyName(name, true);
      const previous = seen.get(transformed);
      seen.set(transformed, name);

      return previous !== undefined && previous !== name ? [previous, name] : undefined;
    },
  );
}

function schemaEntries(value: unknown): Array<readonly [string, ParsedSchema]> {
  return Predicate.isObject(value)
    ? Array.filter(Record.toEntries(value), (entry): entry is [string, ParsedSchema] =>
        isParsedSchema(entry[1]),
      )
    : [];
}

function schemaList(value: unknown): ParsedSchema[] {
  const candidates: readonly unknown[] = Array.isArray(value) ? value : [];

  return Array.filter(candidates, (candidate): candidate is ParsedSchema =>
    isParsedSchema(candidate),
  );
}

/** Find a name collision at any object depth reached through composition and references. */
export function schemaPropertyCollision(
  schema: ParsedSchema,
  resolve: (ref: string) => ParsedSchema | undefined,
  extraNames: readonly string[] = [],
): readonly [string, string] | undefined {
  const schemaIds = new WeakMap<object, number>();
  const inspected = new Set<string>();
  let nextId = 0;

  const expand = (
    current: ParsedSchema,
    visitedRefs: ReadonlySet<string>,
  ): Array<Record<string, unknown>> => {
    if (!Predicate.isObject(current)) return [];

    const ref = Predicate.isString(current.$ref) ? current.$ref : undefined;
    const referenced = ref && !visitedRefs.has(ref) ? resolve(ref) : undefined;
    const nextRefs = ref ? new Set(visitedRefs).add(ref) : visitedRefs;

    const variants = Array.flatMap(["allOf", "anyOf", "oneOf"] as const, (keyword) =>
      schemaList(current[keyword]),
    );

    return [
      current,
      ...Array.flatMap(referenced === undefined ? variants : [referenced, ...variants], (member) =>
        expand(member, nextRefs),
      ),
    ];
  };

  const inspect = (
    schemas: readonly ParsedSchema[],
    additionalNames: readonly string[] = [],
  ): readonly [string, string] | undefined => {
    const expanded = Array.flatMap(schemas, (member) => expand(member, new Set()));
    if (expanded.length === 0) return undefined;

    const signature = Array.map(expanded, (member) => {
      let id = schemaIds.get(member);

      if (id === undefined) {
        id = ++nextId;
        schemaIds.set(member, id);
      }

      return id;
    }).join(",");

    if (inspected.has(signature)) return undefined;
    inspected.add(signature);

    const fields = Array.flatMap(expanded, (member) => schemaEntries(member.properties));

    const collision = collidingProperties(
      [...Array.map(fields, ([name]) => name), ...additionalNames],
      true,
    );

    if (collision) return collision;

    const grouped = new Map<string, ParsedSchema[]>();

    Array.forEach(fields, ([name, nested]) =>
      grouped.set(name, Array.append(grouped.get(name) ?? [], nested)),
    );

    const nestedCollision = Array.reduce(
      grouped.values(),
      undefined as readonly [string, string] | undefined,
      (found, group) => found ?? (group.length > 1 ? inspect(group) : undefined),
    );

    if (nestedCollision) return nestedCollision;

    const items = Array.flatMap(expanded, (member) => schemaList(member.items));
    const itemCollision = items.length > 1 ? inspect(items) : undefined;
    if (itemCollision) return itemCollision;

    const additional = Array.flatMap(expanded, (member) => schemaList(member.additionalProperties));

    return additional.length > 1 ? inspect(additional) : undefined;
  };

  return inspect([schema], extraNames);
}

const schemaMapKeywords = new Set(["properties", "patternProperties", "dependentSchemas", "$defs"]);

const schemaKeywords = new Set([
  "additionalProperties",
  "unevaluatedProperties",
  "items",
  "unevaluatedItems",
  "contains",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
]);

const schemaListKeywords = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);

/** A subschema position holds an object or a boolean; anything else is left alone. */
function camelCaseSubschema(value: unknown): unknown {
  return Predicate.isBoolean(value) || Predicate.isObject(value) ? camelCaseSchema(value) : value;
}

function camelCaseName(value: unknown): unknown {
  return Predicate.isString(value) ? propertyName(value, true) : value;
}

function camelCaseNames(value: unknown): unknown {
  return Array.isArray(value) ? Array.map(value, camelCaseName) : value;
}

function mapEntries(
  value: unknown,
  f: (entry: readonly [string, unknown]) => readonly [string, unknown],
): unknown {
  return Predicate.isObject(value)
    ? Record.fromEntries(Array.map(Record.toEntries(value), f))
    : value;
}

function camelCaseKeyword(keyword: string, value: unknown): unknown {
  switch (keyword) {
    case "properties":
    case "dependentSchemas":
      return mapEntries(value, ([name, part]) => [
        propertyName(name, true),
        camelCaseSubschema(part),
      ]);
    case "required":
      return camelCaseNames(value);
    case "dependentRequired":
      return mapEntries(value, ([name, names]) => [
        propertyName(name, true),
        camelCaseNames(names),
      ]);
    case "discriminator":
      return Predicate.isObject(value) && Predicate.isString(value.propertyName)
        ? { ...value, propertyName: propertyName(value.propertyName, true) }
        : value;
  }

  if (schemaMapKeywords.has(keyword))
    return mapEntries(value, ([name, part]) => [name, camelCaseSubschema(part)]);

  if (schemaKeywords.has(keyword)) return camelCaseSubschema(value);

  if (schemaListKeywords.has(keyword))
    return Array.isArray(value) ? Array.map(value, camelCaseSubschema) : value;

  return value;
}

/**
 * Rename snake_case property names to camelCase throughout a schema tree.
 *
 * Renames `properties` keys, `required` entries, `dependentRequired` keys and values,
 * `dependentSchemas` keys, and `discriminator.propertyName` with `propertyName(name, true)`, and
 * recurses into every subschema. Values such as `enum`, `const`, `default`, and `examples`,
 * `patternProperties` keys, and `$ref`s keep their spelling. References are not resolved and
 * collisions are not detected; use `schemaPropertyCollision` first. The input is not modified.
 */
export function camelCaseSchema(schema: ParsedSchema): ParsedSchema {
  if (Predicate.isBoolean(schema)) return schema;

  return Record.fromEntries(
    Array.map(Record.toEntries(schema), ([keyword, value]) => [
      keyword,
      camelCaseKeyword(keyword, value),
    ]),
  );
}
