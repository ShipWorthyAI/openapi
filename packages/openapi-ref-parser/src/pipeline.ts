import { JsonPointer, JsonSchema } from "effect";
import type { DereferenceHooks } from "./plugins.js";
import { asRecord, getAt, joinPointer } from "./pointer.js";
import { componentSchemas, schemaSlots } from "./upgraders/openapi-3_0.js";
import { InvalidPointerError, MissingPointerError } from "./errors.js";

const ANNOTATIONS = ["example", "discriminator", "xml", "externalDocs", "nullable"] as const;

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

  for (const slot of componentSchemas(document)) {
    const normalized = normalizeSchema(slot.parent[slot.key]);
    if (!normalized) continue;
    definitions[slot.key] = normalized.schema;
    mergeDefinitions(definitions, normalized.definitions, normalized.schema);
  }

  const others = schemaSlots(document, false);
  const slotSchemas: JsonSchema.JsonSchema[] = [];

  for (const slot of others) {
    const normalized = normalizeSchema(slot.parent[slot.key]);

    if (!normalized) {
      slotSchemas.push({} as JsonSchema.JsonSchema);
      continue;
    }

    mergeDefinitions(definitions, normalized.definitions, normalized.schema);
    slot.parent[slot.key] = normalized.schema;
    slotSchemas.push(normalized.schema);
  }

  const recursive = recursiveNames(definitions);
  const rootDefs = new Set(Object.keys(asRecord(document.$defs) ?? {}));
  const aliases = new Map<string, string | null>();
  const resolving = new Set<string>();

  for (const name of Object.keys(definitions)) {
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
  for (const [name, schema] of Object.entries(definitions))
    park(schema, "definition", name, [], parked);
  slotSchemas.forEach((schema, index) => park(schema, "schema", String(index), [], parked));

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
  components.schemas = converted.definitions;

  others.forEach((slot, index) => {
    slot.parent[slot.key] = converted.schemas[index];
  });

  rewriteLeftoverDefinitionRefs(document);
  restoreRootDefs(document);

  if (mode === "dereference") inlineRemaining(document, recursive, hooks);
}

function normalizeSchema(value: unknown): JsonSchema.Document<"draft-2020-12"> | undefined {
  if (typeof value === "boolean") return { dialect: "draft-2020-12", schema: {}, definitions: {} };
  const record = asRecord(value);
  if (!record) return undefined;
  const normalized = JsonSchema.fromSchemaOpenApi3_1(liftSiblings(record) as JsonSchema.JsonSchema);
  // A schema $id is its own resource, so its $defs join the shared pool.
  // Nested $defs on a schema without $id stay on that schema.
  if (typeof record.$id === "string") return normalized;
  const extracted = asRecord(normalized.definitions);
  if (!extracted || Object.keys(extracted).length === 0) return normalized;
  const schema = asRecord(normalized.schema) ?? {};
  schema.$defs = { ...asRecord(schema.$defs), ...extracted };
  return { dialect: normalized.dialect, schema, definitions: {} };
}

function mergeDefinitions(
  pool: Record<string, JsonSchema.JsonSchema>,
  extra: JsonSchema.Definitions,
  owner: JsonSchema.JsonSchema,
): void {
  for (const [name, schema] of Object.entries(extra)) {
    if (!Object.hasOwn(pool, name)) {
      pool[name] = schema;
      continue;
    }

    if (JSON.stringify(pool[name]) === JSON.stringify(schema)) continue;
    const unique = uniqueName(pool, name);
    pool[unique] = schema;
    rewriteDefName(owner, name, unique);
    rewriteDefName(schema, name, unique);
  }
}

function uniqueName(pool: Record<string, unknown>, name: string): string {
  let suffix = 2;
  while (Object.hasOwn(pool, `${name}_${suffix}`)) suffix += 1;
  return `${name}_${suffix}`;
}

function rewriteDefName(schema: unknown, from: string, to: string): void {
  const record = asRecord(schema);
  if (!record) return;
  if (record.$ref === `#/$defs/${from}`) record.$ref = `#/$defs/${to}`;
  for (const value of Object.values(record)) rewriteDefName(value, from, to);
}

function liftSiblings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => liftSiblings(item));
  const record = asRecord(value);
  if (!record) return value;
  const lifted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) lifted[key] = liftSiblings(child);
  if (typeof lifted.$ref !== "string") return lifted;
  const siblings = { ...lifted };
  delete siblings.$ref;
  // readOnly/writeOnly stay beside $ref so generators can wrap the reference itself.
  const flags: Record<string, unknown> = {};

  for (const key of ["readOnly", "writeOnly"] as const) {
    if (siblings[key] === true) {
      flags[key] = true;
      delete siblings[key];
    }
  }

  if (Object.keys(siblings).length === 0) return { $ref: lifted.$ref, ...flags };
  return { allOf: [{ $ref: lifted.$ref }, siblings], ...flags };
}

function recursiveNames(definitions: Record<string, JsonSchema.JsonSchema>): Set<string> {
  const names = Object.keys(definitions);
  const dependencies = new Map(names.map((name) => [name, collectDefRefs(definitions[name]!)]));
  const recursive = new Set<string>();
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];

  const visit = (name: string) => {
    const current = state.get(name) ?? 0;

    if (current === 1) {
      const start = stack.indexOf(name);
      const cycle = stack.slice(start);

      if (cycle.every((item) => isPureRef(definitions[item]))) {
        throw new ReferenceError(`Definition ${JSON.stringify(name)} is a circular alias.`);
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
  if (typeof value !== "object" || value === null || seen.has(value)) return found;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) collectDefRefs(item, found, seen);
    return found;
  }

  const ref = (value as { $ref?: unknown }).$ref;

  if (typeof ref === "string") {
    const key = referenceKey(ref);
    if (key) found.add(key);
  }

  for (const child of Object.values(value)) collectDefRefs(child, found, seen);
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
  if (Array.isArray(value)) {
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
    if (!key) return record;

    if (!Object.hasOwn(definitions, key)) {
      if (rootDefs.has(key)) {
        record.$ref = rootDefRef(key);
        return record;
      }

      throw new MissingPointerError(key, record.$ref, record.$ref);
    }

    const final = finalName(key, definitions, aliases);
    const ref = joinPointer("#/$defs", final);

    if (recursive.has(final) || mode === "bundle") {
      if (recursive.has(final)) hooks?.onCircular?.(pointer);
      record.$ref = ref;
      return record;
    }

    if (resolving.has(final))
      throw new ReferenceError(`Definition ${JSON.stringify(final)} is a circular alias.`);
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
    hooks?.onDereference?.(pointer, resolved, record, "$ref");
    return resolved;
  }

  for (const [key, child] of Object.entries(record)) {
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
    if (cached == null)
      throw new ReferenceError(`Definition ${JSON.stringify(name)} is a circular alias.`);
    return cached;
  }

  aliases.set(name, null);
  const schema = definitions[name];

  if (isPureRef(schema)) {
    const key = referenceKey(schema.$ref);

    if (key && Object.hasOwn(definitions, key)) {
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
  return Boolean(record && typeof record.$ref === "string" && Object.keys(record).length === 1);
}

function referenceKey(ref: string): string | undefined {
  if (!ref.startsWith("#")) return undefined;
  const tokens = JsonPointer.parseUriFragment(ref);
  if (tokens === undefined) throw new InvalidPointerError(ref, ref);
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
    if (!Object.hasOwn(record, key)) continue;
    saved.push({ scope, id, pointer: [...pointer], key, value: record[key] });
    delete record[key];
  }

  for (const key of NESTED_SINGLE) park(record[key], scope, id, [...pointer, key], saved);

  for (const key of NESTED_ARRAY) {
    if (!Array.isArray(record[key])) continue;
    (record[key] as unknown[]).forEach((item, index) =>
      park(item, scope, id, [...pointer, key, String(index)], saved),
    );
  }

  for (const key of NESTED_MAP) {
    const map = asRecord(record[key]);
    if (!map) continue;
    for (const child of Object.keys(map))
      park(map[child], scope, id, [...pointer, key, child], saved);
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
    if (Array.isArray(current)) {
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
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const record = asRecord(value);
    if (!record) return;

    if (typeof record.$ref === "string" && record.$ref.startsWith("#/root-defs/")) {
      const name = record.$ref.slice("#/root-defs/".length);
      record.$ref = joinPointer("#/$defs", JsonPointer.unescapeToken(name));
    }

    for (const child of Object.values(record)) visit(child);
  };

  visit(document);
}

function rewriteLeftoverDefinitionRefs(document: Record<string, unknown>): void {
  const names = new Set(Object.keys(asRecord(asRecord(document.components)?.schemas) ?? {}));

  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const record = asRecord(value);
    if (!record) return;

    if (typeof record.$ref === "string" && record.$ref.startsWith("#/$defs/")) {
      const tokens = JsonPointer.parseUriFragment(record.$ref);
      const name = tokens?.[0] === "$defs" ? tokens[1] : undefined;

      if (name && names.has(name)) {
        record.$ref = joinPointer("#/components/schemas", [name, ...(tokens?.slice(2) ?? [])]);
      }
    }

    for (const child of Object.values(record)) visit(child);
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
    if (Array.isArray(value)) {
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

    if (typeof record.$ref === "string" && record.$ref.startsWith("#") && parent && key) {
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

    for (const [childKey, child] of Object.entries(record)) {
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
