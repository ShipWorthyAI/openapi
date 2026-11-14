import {
  Array as Arr,
  Formatter,
  JsonPointer,
  JsonSchema,
  Predicate,
  Record as Rec,
  String as Str,
} from "effect";
import type { DereferenceHooks } from "./plugins.ts";
import { getAt, joinPointer } from "./pointer.ts";
import { componentSchemas, schemaSlots } from "./upgraders/3.0-to-3.1.ts";
import {
  bundleFailure,
  circularAliasFailure,
  invalidPointerFailure,
  missingPointerFailure,
} from "./errors.ts";

const ANNOTATIONS = ["example", "discriminator", "xml", "externalDocs", "nullable"] as const;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return Predicate.isObject(value) ? value : undefined;
}

const NESTED_SINGLE = [
  "additionalProperties",
  "unevaluatedProperties",
  "items",
  "contains",
  "not",
  "if",
  "then",
  "else",
  "propertyNames",
  "unevaluatedItems",
  "contentSchema",
];

const NESTED_ARRAY = ["allOf", "anyOf", "oneOf", "prefixItems"];
const NESTED_MAP = ["properties", "patternProperties", "$defs", "dependentSchemas"];

interface SavedAnnotation {
  scope: "definition" | "schema";
  id: string;
  pointer: string[];
  key: string;
  value: unknown;
}

export function runSchemaPipeline(
  document: Record<string, unknown>,
  mode: "bundle" | "dereference",
  hooks: DereferenceHooks | undefined,
): void {
  const definitions: Record<string, JsonSchema.JsonSchema> = {};
  const definitionOrder: string[] = [];
  const booleanDefinitions = new Map<string, boolean>();

  for (const slot of componentSchemas(document)) {
    const value = slot.parent[slot.key];

    if (typeof value === "boolean") {
      booleanDefinitions.set(slot.key, value);
    }

    const normalized = normalizeSchema(slot.parent[slot.key]);
    definitions[slot.key] = normalized.schema;
    rememberDefinition(definitionOrder, slot.key);
    mergeDefinitions(definitions, normalized.definitions, normalized.schema, definitionOrder);
  }

  const others = schemaSlots(document, false);
  const slotSchemas: JsonSchema.JsonSchema[] = [];

  const booleanSlots = Arr.map(others, (slot) => {
    const value = slot.parent[slot.key];
    return typeof value === "boolean" ? value : undefined;
  });

  for (const slot of others) {
    const normalized = normalizeSchema(slot.parent[slot.key]);

    mergeDefinitions(definitions, normalized.definitions, normalized.schema, definitionOrder);
    slot.parent[slot.key] = normalized.schema;
    slotSchemas.push(normalized.schema);
  }

  const recursive = recursiveNames(definitions);
  const rootDefs = new Set(Rec.keys(asRecord(document.$defs) ?? {}));
  const aliases = new Map<string, string | null>();
  const resolving = new Set<string>();

  for (const name of Rec.keys(definitions)) {
    definitions[name] = resolveValue(
      definitions[name],
      definitions,
      rootDefs,
      recursive,
      aliases,
      resolving,
      mode,
      hooks,
      `#/$defs/${name}`,
    ) as JsonSchema.JsonSchema;
  }

  for (let index = 0; index < slotSchemas.length; index++) {
    slotSchemas[index] = resolveValue(
      slotSchemas[index],
      definitions,
      rootDefs,
      recursive,
      aliases,
      resolving,
      mode,
      hooks,
      "#",
    ) as JsonSchema.JsonSchema;

    const slot = others[index];
    if (slot) slot.parent[slot.key] = slotSchemas[index];
  }

  const parked: SavedAnnotation[] = [];
  for (const [name, schema] of Rec.toEntries(definitions))
    park(schema, "definition", name, [], parked);
  Arr.forEach(slotSchemas, (schema, index) => park(schema, "schema", String(index), [], parked));

  const schemas = (slotSchemas.length > 0 ? slotSchemas : [{}]) as [
    JsonSchema.JsonSchema,
    ...JsonSchema.JsonSchema[],
  ];

  const converted = JsonSchema.toMultiDocumentOpenApi3_1({
    dialect: "draft-2020-12",
    schemas,
    definitions,
  });

  restore(converted, parked);
  const components = asRecord(document.components) ?? {};
  document.components = components;
  components.schemas = orderDefinitions(converted.definitions, definitionOrder);

  for (const slot of componentSchemas(document)) {
    const value = booleanDefinitions.get(slot.key);
    if (value !== undefined) slot.parent[slot.key] = value;
  }

  Arr.forEach(others, (slot, index) => {
    slot.parent[slot.key] = booleanSlots[index] ?? converted.schemas[index];
  });

  rewriteLeftoverDefinitionRefs(document);
  restoreRootDefs(document);

  if (mode === "dereference") inlineRemaining(document, recursive, hooks);
}

function normalizeSchema(value: unknown): JsonSchema.Document<"draft-2020-12"> {
  if (typeof value === "boolean") {
    return { dialect: "draft-2020-12", schema: value ? {} : { not: {} }, definitions: {} };
  }

  const record = asRecord(value);
  if (!record) throw bundleFailure("A schema position must contain an object or a boolean");
  const normalized = JsonSchema.fromSchemaOpenApi3_1(record as JsonSchema.JsonSchema);
  // A schema $id is its own resource, so its $defs join the shared pool.
  // Nested $defs on a schema without $id stay on that schema.
  if (typeof record.$id === "string") return normalized;
  const extracted = asRecord(normalized.definitions);
  if (!extracted || Rec.isEmptyRecord(extracted)) return normalized;
  const schema = asRecord(normalized.schema) ?? {};
  schema.$defs = { ...asRecord(schema.$defs), ...extracted };
  return { dialect: normalized.dialect, schema, definitions: {} };
}

function mergeDefinitions(
  pool: Record<string, JsonSchema.JsonSchema>,
  extra: JsonSchema.Definitions,
  owner: JsonSchema.JsonSchema,
  order: string[],
): void {
  for (const [name, schema] of Rec.toEntries(extra)) {
    if (!Rec.has(pool, name)) {
      pool[name] = schema;
      rememberDefinition(order, name);
      continue;
    }

    if (Formatter.formatJson(pool[name]) === Formatter.formatJson(schema)) continue;
    const unique = uniqueName(pool, name);
    pool[unique] = schema;
    rememberDefinition(order, unique);
    rewriteDefName(owner, name, unique);
    rewriteDefName(schema, name, unique);
  }
}

function rememberDefinition(order: string[], name: string) {
  if (!order.includes(name)) order.push(name);
}

function orderDefinitions(definitions: unknown, order: readonly string[]): unknown {
  const source = asRecord(definitions);
  if (!source) return definitions;
  const output: Record<string, unknown> = {};

  for (const name of order) {
    if (Rec.has(source, name)) output[name] = source[name];
  }

  for (const name of Rec.keys(source)) {
    if (!Rec.has(output, name)) output[name] = source[name];
  }

  return output;
}

function uniqueName(pool: Record<string, unknown>, name: string): string {
  let suffix = 2;
  while (Rec.has(pool, `${name}_${suffix}`)) suffix += 1;
  return `${name}_${suffix}`;
}

function rewriteDefName(schema: unknown, from: string, to: string): void {
  const record = asRecord(schema);
  if (!record) return;
  if (record.$ref === `#/$defs/${from}`) record.$ref = `#/$defs/${to}`;
  for (const value of Rec.values(record)) rewriteDefName(value, from, to);
}

function recursiveNames(definitions: Record<string, JsonSchema.JsonSchema>): Set<string> {
  const names = Rec.keys(definitions);

  const dependencies = new Map(
    Arr.map(names, (name): [string, Set<string>] => [name, collectDefRefs(definitions[name]!)]),
  );

  const recursive = new Set<string>();
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];

  const visit = (name: string) => {
    const current = state.get(name) ?? 0;

    if (current === 1) {
      const start = stack.indexOf(name);
      const cycle = stack.slice(start);

      if (Arr.every(cycle, (item) => isPureRef(definitions[item]))) {
        throw circularAliasFailure(name);
      }

      for (const item of cycle) recursive.add(item);
      return;
    }

    if (current === 2) return;
    state.set(name, 1);
    stack.push(name);

    for (const dependency of dependencies.get(name) ?? []) {
      if (dependencies.has(dependency)) visit(dependency);
    }

    stack.pop();
    state.set(name, 2);
  };

  for (const name of names) visit(name);
  return recursive;
}

function collectDefRefs(
  value: unknown,
  found = new Set<string>(),
  seen = new Set<object>(),
): Set<string> {
  if (!Predicate.isObjectOrArray(value) || seen.has(value)) return found;
  seen.add(value);

  if (Arr.isArray(value)) {
    for (const item of value) collectDefRefs(item, found, seen);
    return found;
  }

  const record: Record<string, unknown> = value;
  const ref = record.$ref;

  if (typeof ref === "string") {
    const key = referenceKey(ref);
    if (key) found.add(key);
  }

  for (const child of Rec.values(record)) collectDefRefs(child, found, seen);
  return found;
}

const rootDefRef = (name: string) => `#/root-defs/${JsonPointer.escapeToken(name)}`;

function resolveValue(
  value: unknown,
  definitions: Record<string, JsonSchema.JsonSchema>,
  rootDefs: Set<string>,
  recursive: Set<string>,
  aliases: Map<string, string | null>,
  resolving: Set<string>,
  mode: "bundle" | "dereference",
  hooks: DereferenceHooks | undefined,
  pointer: string,
): unknown {
  if (Arr.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      value[index] = resolveValue(
        value[index],
        definitions,
        rootDefs,
        recursive,
        aliases,
        resolving,
        mode,
        hooks,
        joinPointer(pointer, String(index)),
      );
    }

    return value;
  }

  const record = asRecord(value);
  if (!record) return value;

  if (typeof record.$ref === "string") {
    const key = referenceKey(record.$ref);

    if (key && !Rec.has(definitions, key)) {
      if (rootDefs.has(key)) {
        record.$ref = rootDefRef(key);
      } else {
        throw missingPointerFailure(key, record.$ref, record.$ref);
      }
    } else if (key) {
      const final = finalName(key, definitions, aliases);
      const ref = joinPointer("#/$defs", final);

      if (recursive.has(final) || mode === "bundle") {
        if (recursive.has(final)) hooks?.onCircular?.(pointer);
        record.$ref = ref;
      } else {
        if (resolving.has(final)) throw circularAliasFailure(final);
        resolving.add(final);

        const resolved = resolveValue(
          structuredClone(definitions[final]),
          definitions,
          rootDefs,
          recursive,
          aliases,
          resolving,
          mode,
          hooks,
          ref,
        );

        resolving.delete(final);
        const siblings = { ...record };
        delete siblings.$ref;

        const result = Rec.isEmptyRecord(siblings)
          ? resolved
          : {
              allOf: [
                resolved,
                resolveValue(
                  siblings,
                  definitions,
                  rootDefs,
                  recursive,
                  aliases,
                  resolving,
                  mode,
                  hooks,
                  pointer,
                ),
              ],
            };

        hooks?.onDereference?.(pointer, result, record, "$ref");
        return result;
      }
    }
  }

  for (const [key, child] of Rec.toEntries(record)) {
    record[key] = resolveValue(
      child,
      definitions,
      rootDefs,
      recursive,
      aliases,
      resolving,
      mode,
      hooks,
      joinPointer(pointer, key),
    );
  }

  return record;
}

function finalName(
  name: string,
  definitions: Record<string, JsonSchema.JsonSchema>,
  aliases: Map<string, string | null>,
): string {
  if (aliases.has(name)) {
    const cached = aliases.get(name);
    if (cached == null) throw circularAliasFailure(name);
    return cached;
  }

  aliases.set(name, null);
  const schema = definitions[name];

  if (isPureRef(schema)) {
    const key = referenceKey(schema.$ref);

    if (key && Rec.has(definitions, key)) {
      const resolved = finalName(key, definitions, aliases);
      aliases.set(name, resolved);
      return resolved;
    }
  }

  aliases.set(name, name);
  return name;
}

function isPureRef(value: unknown): value is { $ref: string } {
  const record = asRecord(value);
  return Boolean(record && typeof record.$ref === "string" && Rec.size(record) === 1);
}

function referenceKey(ref: string): string | undefined {
  if (!Str.startsWith("#")(ref)) return undefined;
  const tokens = JsonPointer.parseUriFragment(ref);
  if (tokens === undefined) throw invalidPointerFailure(ref, ref);
  return tokens.length === 2 && tokens[0] === "$defs" ? tokens[1] : undefined;
}

function park(
  value: unknown,
  scope: SavedAnnotation["scope"],
  id: string,
  pointer: string[],
  saved: SavedAnnotation[],
) {
  const record = asRecord(value);
  if (!record) return;

  for (const key of ANNOTATIONS) {
    if (!Rec.has(record, key)) continue;
    saved.push({ scope, id, pointer: [...pointer], key, value: record[key] });
    delete record[key];
  }

  for (const key of NESTED_SINGLE) park(record[key], scope, id, [...pointer, key], saved);

  for (const key of NESTED_ARRAY) {
    const items = record[key];
    if (!Arr.isArray(items)) continue;

    Arr.forEach(items, (item, index) =>
      park(item, scope, id, [...pointer, key, String(index)], saved),
    );
  }

  for (const key of NESTED_MAP) {
    const map = asRecord(record[key]);
    if (!map) continue;
    for (const child of Rec.keys(map)) park(map[child], scope, id, [...pointer, key, child], saved);
  }
}

function restore(converted: JsonSchema.MultiDocument<"openapi-3.1">, saved: SavedAnnotation[]) {
  for (const annotation of saved) {
    const schema =
      annotation.scope === "definition"
        ? converted.definitions[annotation.id]
        : converted.schemas[Number(annotation.id)];

    const target = annotation.pointer.length === 0 ? schema : descend(schema, annotation.pointer);
    const record = asRecord(target);
    if (record) record[annotation.key] = annotation.value;
  }
}

function descend(value: unknown, pointer: string[]): unknown {
  let current = value;

  for (const token of pointer) {
    if (Arr.isArray(current)) {
      current = current[Number(token)];
      continue;
    }

    const record = asRecord(current);
    if (!record) return undefined;
    current = record[token];
  }

  return current;
}

function restoreRootDefs(document: Record<string, unknown>): void {
  const visit = (value: unknown) => {
    if (Arr.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const record = asRecord(value);
    if (!record) return;

    if (typeof record.$ref === "string" && Str.startsWith("#/root-defs/")(record.$ref)) {
      const name = Str.slice("#/root-defs/".length)(record.$ref);
      record.$ref = joinPointer("#/$defs", JsonPointer.unescapeToken(name));
    }

    for (const child of Rec.values(record)) visit(child);
  };

  visit(document);
}

function rewriteLeftoverDefinitionRefs(document: Record<string, unknown>): void {
  const names = new Set(Rec.keys(asRecord(asRecord(document.components)?.schemas) ?? {}));

  const visit = (value: unknown) => {
    if (Arr.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const record = asRecord(value);
    if (!record) return;

    if (typeof record.$ref === "string" && Str.startsWith("#/$defs/")(record.$ref)) {
      const tokens = JsonPointer.parseUriFragment(record.$ref);
      const name = tokens?.[0] === "$defs" ? tokens[1] : undefined;

      if (name && names.has(name)) {
        record.$ref = joinPointer("#/components/schemas", [name, ...(tokens?.slice(2) ?? [])]);
      }
    }

    for (const child of Rec.values(record)) visit(child);
  };

  visit(document);
}

export function inlineRemaining(
  document: Record<string, unknown>,
  recursive: Set<string>,
  hooks: DereferenceHooks | undefined,
) {
  const visiting = new Set<string>();

  const walk = (value: unknown, parent?: Record<string, unknown>, key?: string, pointer = "#") => {
    if (Arr.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        walk(
          value[index],
          value as unknown as Record<string, unknown>,
          String(index),
          joinPointer(pointer, String(index)),
        );
      }

      return;
    }

    const record = asRecord(value);
    if (!record) return;

    if (typeof record.$ref === "string" && Str.startsWith("#")(record.$ref) && parent && key) {
      const ref = record.$ref;
      const name = componentSchemaName(ref);

      if (name && recursive.has(name)) {
        hooks?.onCircular?.(pointer);
        return;
      }

      if (visiting.has(ref)) {
        hooks?.onCircular?.(pointer);
        return;
      }

      const target = getAt(document, ref, ref);
      visiting.add(ref);
      const copy = structuredClone(target);
      walk(copy, undefined, undefined, ref);
      visiting.delete(ref);
      parent[key] = copy;
      hooks?.onDereference?.(pointer, copy, parent, key);
      return;
    }

    for (const [childKey, child] of Rec.toEntries(record)) {
      walk(child, record, childKey, joinPointer(pointer, childKey));
    }
  };

  walk(document);
}

function componentSchemaName(ref: string): string | undefined {
  const tokens = JsonPointer.parseUriFragment(ref);
  if (!tokens || tokens[0] !== "components" || tokens[1] !== "schemas" || tokens.length !== 3)
    return undefined;
  return tokens[2];
}
