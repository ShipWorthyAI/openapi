import type { Generator } from "@shipworthy/openapi-generator";
import { ParsedSchema, type ParsedService } from "@shipworthy/openapi-transformer";
import {
  Array,
  Effect,
  Iterable,
  JsonPointer,
  JsonSchema,
  Match,
  Option,
  Predicate,
  pipe,
  Record,
  Result,
  Schema,
  SchemaRepresentation,
} from "effect";
import { SchemaGenerationError } from "./errors.ts";

const sequential = { concurrency: 1, discard: true } as const;

const identifierPattern = /[A-Za-z_$][A-Za-z0-9_$]*/g;

type Pool = Record<string, JsonSchema.JsonSchema>;

export const standardSchema: Generator<string, SchemaGenerationError> = {
  id: "standard-schema",
  generate: Effect.fnUntraced(function* (
    model: ParsedService,
  ): Effect.fn.Return<string, SchemaGenerationError> {
    return yield* pipe(
      Record.keys(model.components.schemas),
      Array.match({
        onEmpty: () => Effect.succeed(""),
        onNonEmpty: (names) =>
          pipe(
            assemble(model, names),
            Effect.flatMap(importSchemas),
            Effect.flatMap(compileSchemas),
            Effect.flatMap(emitModule(names)),
          ),
      }),
      Effect.catchDefect((cause) => Effect.fail(failure(cause))),
    );
  }),
};

const importSchemas = Effect.fnUntraced(function* (
  document: JsonSchema.MultiDocument<"draft-2020-12">,
) {
  return yield* Effect.try({
    try: () => SchemaRepresentation.fromJsonSchemaMultiDocument(document, { patterns: "apply" }),
    catch: failure,
  });
});

const compileSchemas = Effect.fnUntraced(function* (
  schemas: Array.NonEmptyReadonlyArray<Schema.Top>,
) {
  return yield* Effect.try({
    try: () =>
      pipe(
        schemas,
        Array.map((schema) => schema.ast),
        SchemaRepresentation.toRepresentations,
        SchemaRepresentation.toCodeDocument,
      ),
    catch: failure,
  });
});

function emitModule(names: readonly string[]) {
  return Effect.fnUntraced(function* (code: SchemaRepresentation.CodeDocument) {
    return yield* emit(names, code);
  });
}

function failure(cause: unknown): SchemaGenerationError {
  if (Schema.is(SchemaGenerationError)(cause)) return cause;

  return new SchemaGenerationError({
    message: Predicate.isError(cause) ? cause.message : String(cause),
    cause,
  });
}

const decodeSchema = Schema.decodeUnknownResult(ParsedSchema);
const decodeSchemaMap = Schema.decodeUnknownResult(Schema.Record(Schema.String, Schema.Unknown));
const decodeSchemaList = Schema.decodeUnknownResult(Schema.Array(Schema.Unknown));
const decodeReference = Schema.decodeUnknownResult(Schema.String);

const assemble = Effect.fnUntraced(function* (
  model: ParsedService,
  names: Array.NonEmptyReadonlyArray<string>,
): Effect.fn.Return<JsonSchema.MultiDocument<"draft-2020-12">, SchemaGenerationError> {
  const componentNames = new Set(names);
  const rootKeys = rootDefinitionKeys(model.$defs, componentNames);

  const rootRenames = new Map(
    Array.filter(Array.fromIterable(rootKeys), ([name, key]) => name !== key),
  );

  const pool: Pool = {};

  const convertedComponents = yield* Effect.forEach(
    names,
    (name) =>
      prepare(
        model.components.schemas[name],
        `#/components/schemas/${name}`,
        componentNames,
        rootRenames,
      ),
    { concurrency: 1 },
  );

  yield* Effect.forEach(
    Array.zip(names, convertedComponents),
    ([name, converted]) =>
      Effect.sync(() => {
        pool[name] = converted.schema;
      }),
    sequential,
  );

  const convertedRoots = yield* Effect.forEach(
    Record.toEntries(model.$defs),
    Effect.fnUntraced(function* ([name, schema]) {
      const converted = yield* prepare(schema, `#/$defs/${name}`, componentNames, rootRenames);
      return { name, key: rootKeys.get(name) ?? name, converted };
    }),
    { concurrency: 1 },
  );

  yield* Effect.forEach(
    convertedRoots,
    Effect.fnUntraced(function* ({ name, key, converted }) {
      const component = pool[name];

      if (
        key !== name &&
        component !== undefined &&
        (yield* sameSchema(component, converted.schema))
      ) {
        const target = componentToken(name);

        const schemas = [
          ...Record.values(pool),
          converted.schema,
          ...Record.values(converted.definitions),
          ...Array.flatMap(convertedRoots, ({ converted }) => [
            converted.schema,
            ...Record.values(converted.definitions),
          ]),
        ];

        yield* Effect.forEach(schemas, (schema) => rewriteDefKey(schema, key, target), sequential);
      } else {
        pool[key] = converted.schema;
      }
    }),
    sequential,
  );

  yield* Effect.forEach(
    [...convertedComponents, ...Array.map(convertedRoots, ({ converted }) => converted)],
    (converted) => mergeDefinitions(pool, converted.definitions, converted.schema),
    sequential,
  );

  const bindings = yield* bindComponents(pool, names);

  return yield* Effect.try({
    try: () => ({
      dialect: "draft-2020-12" as const,
      schemas: Array.map(names, (name) => ({ $ref: defRef(binding(bindings, name)) })),
      definitions: pool,
    }),
    catch: failure,
  });
});

function binding(bindings: ReadonlyMap<string, string>, name: string): string {
  const value = bindings.get(name);
  if (value === undefined)
    throw new SchemaGenerationError({ message: `Missing binding for ${name}` });
  return value;
}

function rootDefinitionKeys(
  defs: ParsedService["$defs"],
  componentNames: ReadonlySet<string>,
): Map<string, string> {
  const used = new Set(componentNames);
  const keys = new Map<string, string>();

  Array.forEach(Record.keys(defs), (name) => {
    const key = used.has(name) ? uniqueAgainst(used, name) : name;
    used.add(key);
    keys.set(name, key);
  });

  return keys;
}

const prepare = Effect.fnUntraced(function* (
  value: ParsedSchema | undefined,
  path: string,
  componentNames: ReadonlySet<string>,
  rootRenames: ReadonlyMap<string, string>,
) {
  return yield* pipe(
    normalize(value, path),
    Effect.flatMap(retargetComponentRefs(componentNames)),
    Effect.flatMap(retargetRootDefRefs(rootRenames)),
    Effect.flatMap((schema) =>
      Effect.try({ try: () => JsonSchema.fromSchemaOpenApi3_1(schema), catch: failure }),
    ),
  );
});

const normalize = Effect.fnUntraced(function* (value: ParsedSchema | undefined, path: string) {
  return yield* pipe(
    Effect.fromResult(decodeSchema(value)),
    Effect.mapError(
      () => new SchemaGenerationError({ message: `${path}: expected a JSON schema` }),
    ),
    Effect.flatMap((parsed) =>
      Effect.try({
        try: () =>
          Match.value(parsed).pipe(
            Match.when(Predicate.isBoolean, (value) => (value ? {} : { not: {} })),
            Match.orElse((schema) => structuredClone(schema)),
          ),
        catch: failure,
      }),
    ),
  );
});

const mergeDefinitions = Effect.fnUntraced(function* (
  pool: Pool,
  extra: JsonSchema.Definitions,
  owner: JsonSchema.JsonSchema,
) {
  return yield* Effect.forEach(
    Record.toEntries(extra),
    Effect.fnUntraced(function* ([name, schema]) {
      if (!Object.hasOwn(pool, name)) {
        pool[name] = schema;
        return;
      }

      if (yield* sameSchema(pool[name], schema)) return;
      const unique = uniqueAgainst(new Set(Record.keys(pool)), name);
      pool[unique] = schema;
      yield* rewriteDefKey(owner, name, unique);
      yield* rewriteDefKey(schema, name, unique);
    }),
    sequential,
  );
});

const bindComponents = Effect.fnUntraced(function* (
  pool: Pool,
  names: readonly string[],
): Effect.fn.Return<Map<string, string>, SchemaGenerationError> {
  const used = new Set(Record.keys(pool));

  const bindings = new Map(
    yield* Effect.forEach(
      names,
      Effect.fnUntraced(function* (name) {
        let candidate = `${name}Schema`;

        yield* Effect.whileLoop({
          while: () => used.has(candidate),
          body: () => Effect.succeed(`${candidate}Schema`),
          step: (next) => {
            candidate = next;
          },
        });

        used.add(candidate);
        return [name, candidate] as const;
      }),
      { concurrency: 1 },
    ),
  );

  const replacements = new Map(
    Array.map(
      Array.fromIterable(bindings),
      ([name, binding]) => [componentToken(name), binding] as const,
    ),
  );

  const next: Pool = {};

  yield* Effect.forEach(
    Record.toEntries(pool),
    ([key, schema]) =>
      Effect.sync(() => {
        next[bindings.get(key) ?? key] = schema;
      }),
    sequential,
  );

  yield* Effect.forEach(
    Record.keys(pool),
    (key) =>
      Effect.sync(() => {
        delete pool[key];
      }),
    sequential,
  );

  Object.assign(pool, next);

  yield* Effect.forEach(
    Record.values(pool),
    (schema) => rewriteDefKeys(schema, replacements),
    sequential,
  );

  return bindings;
});

/** Keeps a component ref distinct from a `$defs` entry of the same name until bindings are assigned. */
function componentToken(name: string): string {
  return `\u0000${name}`;
}

function defRef(name: string): string {
  return JsonPointer.formatUriFragment(["$defs", name]);
}

function retargetComponentRefs(names: ReadonlySet<string>) {
  return Effect.fnUntraced(function* (schema: JsonSchema.JsonSchema) {
    return yield* visit(schema, (record) => {
      const ref = Result.getOrUndefined(decodeReference(record.$ref));
      if (ref === undefined) return;
      const path = JsonPointer.parseUriFragment(ref);
      const name = path?.[2];

      if (
        path?.length === 3 &&
        path[0] === "components" &&
        path[1] === "schemas" &&
        name &&
        names.has(name)
      ) {
        record.$ref = defRef(componentToken(name));
      }
    }).pipe(Effect.as(schema));
  });
}

function retargetRootDefRefs(renames: ReadonlyMap<string, string>) {
  return Effect.fnUntraced(function* (schema: JsonSchema.JsonSchema) {
    const local = Result.getOrUndefined(decodeSchemaMap(schema.$defs));

    return yield* visit(schema, (record) => {
      const ref = Result.getOrUndefined(decodeReference(record.$ref));
      if (ref === undefined) return;
      const path = JsonPointer.parseUriFragment(ref);
      const name = path?.[1];
      if (path?.length !== 2 || path[0] !== "$defs" || name === undefined) return;
      const target = renames.get(name);
      if (target === undefined || (local !== undefined && Object.hasOwn(local, name))) return;
      record.$ref = defRef(target);
    }).pipe(Effect.as(schema));
  });
}

const rewriteDefKey = Effect.fnUntraced(function* (
  schema: ParsedSchema | undefined,
  from: string,
  to: string,
) {
  return yield* rewriteDefKeys(schema, new Map([[from, to]]));
});

const rewriteDefKeys = Effect.fnUntraced(function* (
  schema: ParsedSchema | undefined,
  replacements: ReadonlyMap<string, string>,
) {
  return yield* visit(schema, (record) => {
    const ref = Result.getOrUndefined(decodeReference(record.$ref));
    if (ref === undefined) return;
    const path = JsonPointer.parseUriFragment(ref);
    const name = path?.[1];
    if (path === undefined || path.length < 2 || path[0] !== "$defs" || name === undefined) return;
    const next = replacements.get(name);
    if (next === undefined) return;
    record.$ref = JsonPointer.formatUriFragment(["$defs", next, ...path.slice(2)]);
  });
});

const rewriteUnknownSchema = Effect.fnUntraced(function* (
  value: unknown,
  onObject: (schema: JsonSchema.JsonSchema) => void,
) {
  return yield* Result.match(decodeSchema(value), {
    onFailure: () => Effect.succeed(value),
    onSuccess: (schema) => visit(schema, onObject).pipe(Effect.as(schema)),
  });
});

const visit = Effect.fnUntraced(function* (
  schema: ParsedSchema | undefined,
  onObject: (schema: JsonSchema.JsonSchema) => void,
): Effect.fn.Return<void, SchemaGenerationError> {
  if (schema === undefined || typeof schema === "boolean") return;
  yield* Effect.try({ try: () => onObject(schema), catch: failure });

  yield* Effect.forEach(
    ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"],
    Effect.fnUntraced(function* (key) {
      const entries = decodeSchemaMap(schema[key]);
      if (Result.isFailure(entries)) return;

      const values = yield* Effect.forEach(
        Record.toEntries(entries.success),
        Effect.fnUntraced(function* ([name, value]) {
          return [name, yield* rewriteUnknownSchema(value, onObject)] as const;
        }),
        { concurrency: 1 },
      );

      schema[key] = Record.fromEntries(values);
    }),
    sequential,
  );

  yield* Effect.forEach(
    ["allOf", "anyOf", "oneOf", "prefixItems"],
    Effect.fnUntraced(function* (key) {
      const entries = decodeSchemaList(schema[key]);
      if (Result.isFailure(entries)) return;

      schema[key] = yield* Effect.forEach(
        entries.success,
        (value) => rewriteUnknownSchema(value, onObject),
        { concurrency: 1 },
      );
    }),
    sequential,
  );

  yield* Effect.forEach(
    Array.filter(
      [
        "items",
        "additionalItems",
        "additionalProperties",
        "unevaluatedProperties",
        "unevaluatedItems",
        "contains",
        "not",
        "if",
        "then",
        "else",
        "propertyNames",
        "contentSchema",
      ],
      (key) => Object.hasOwn(schema, key),
    ),
    Effect.fnUntraced(function* (key) {
      const entries = decodeSchemaList(schema[key]);

      schema[key] = yield* Result.match(entries, {
        onSuccess: (values) =>
          Effect.forEach(values, (value) => rewriteUnknownSchema(value, onObject), {
            concurrency: 1,
          }),
        onFailure: () => rewriteUnknownSchema(schema[key], onObject),
      });
    }),
    sequential,
  );
});

const sameSchema = Effect.fnUntraced(function* (
  left: JsonSchema.JsonSchema | undefined,
  right: JsonSchema.JsonSchema,
) {
  return yield* Effect.try({
    try: () => JSON.stringify(left) === JSON.stringify(right),
    catch: failure,
  });
});

function uniqueAgainst(used: ReadonlySet<string>, name: string): string {
  return pipe(
    Iterable.makeBy((index) => `${name}_${index + 2}`),
    Iterable.findFirst((candidate) => !used.has(candidate)),
    Option.getOrThrow,
  );
}

const emit = Effect.fnUntraced(function* (
  names: readonly string[],
  code: SchemaRepresentation.CodeDocument,
): Effect.fn.Return<string, SchemaGenerationError> {
  const imports = Array.filterMap(code.artifacts, (artifact) =>
    Match.value(artifact).pipe(
      Match.when({ _tag: "Import" }, (artifact) => Result.succeed(artifact.importDeclaration)),
      Match.orElse(() => Result.failVoid),
    ),
  );

  if (!Array.some(imports, (line) => line.includes("Schema")))
    imports.unshift(`import { Schema } from "effect";`);

  const artifacts = Array.filterMap(code.artifacts, (artifact) =>
    Match.value(artifact).pipe(
      Match.when({ _tag: "Enum" }, (artifact) => Result.succeed(artifact.code.runtime)),
      Match.when({ _tag: "Symbol" }, (artifact) =>
        Result.succeed(`const ${artifact.identifier} = ${artifact.code.runtime};`),
      ),
      Match.orElse(() => Result.failVoid),
    ),
  );

  const nonRecursives = code.references.nonRecursives;
  const recursives = Record.toEntries(code.references.recursives);

  const types = [
    ...Array.map(nonRecursives, ({ $ref, code: body }) => `type ${$ref} = ${body.Type};`),
    ...Array.map(recursives, ([name, body]) => `type ${name} = ${body.Type};`),
  ];

  const forward = forwardReferenced(nonRecursives, recursives);

  const used = new Set<string>([
    ...Array.map(nonRecursives, ({ $ref }) => $ref),
    ...Array.map(recursives, ([name]) => name),
    ...names,
  ]);

  const internals = new Map(
    yield* Effect.forEach(
      forward,
      Effect.fnUntraced(function* (name) {
        return [name, yield* recursiveInternalName(name, used)] as const;
      }),
      { concurrency: 1 },
    ),
  );

  const declarations = Array.map(Array.fromIterable(forward), (name) => {
    const internal = internals.get(name);
    return `const ${name} = Schema.suspend((): Schema.Codec<${name}> => ${internal});`;
  });

  const bodies = [
    ...Array.map(nonRecursives, ({ $ref, code: body }) => `const ${$ref} = ${body.runtime};`),
    ...Array.map(
      recursives,
      ([name, body]) => `const ${internals.get(name) ?? name} = ${body.runtime};`,
    ),
  ];

  const exports = yield* Effect.forEach(
    names,
    Effect.fnUntraced(function* (name, index) {
      const body = code.codes[index];
      if (!body)
        return yield* new SchemaGenerationError({
          message: `Missing generated schema for ${name}`,
        });

      return [
        `export type ${name} = ${body.Type};`,
        `export const ${name} = Schema.toStandardSchemaV1(${body.runtime});`,
      ];
    }),
    { concurrency: 1 },
  );

  return `${[...imports, ...artifacts, ...types, ...declarations, ...bodies, ...Array.flatten(exports)].join("\n")}\n`;
});

function forwardReferenced(
  nonRecursives: readonly { readonly code: SchemaRepresentation.Code }[],
  recursives: readonly (readonly [string, SchemaRepresentation.Code])[],
): Set<string> {
  const names = new Set(Array.map(recursives, ([name]) => name));
  const indexes = new Map(Array.map(recursives, ([name], index) => [name, index]));

  const scan = (runtime: string, accept: (name: string) => boolean) =>
    pipe(
      Array.fromIterable(runtime.matchAll(identifierPattern)),
      Array.map((match) => match[0]),
      Array.filter(Predicate.isNotUndefined),
      Array.filter((name) => names.has(name) && accept(name)),
    );

  return new Set([
    ...Array.flatMap(nonRecursives, ({ code }) => scan(code.runtime, () => true)),
    ...Array.flatMap(recursives, ([, body], index) =>
      scan(body.runtime, (name) => (indexes.get(name) ?? -1) > index),
    ),
  ]);
}

const recursiveInternalName = Effect.fnUntraced(function* (name: string, used: Set<string>) {
  let candidate = `__recursive_${name}`;

  yield* Effect.whileLoop({
    while: () => used.has(candidate),
    body: () => Effect.succeed(`_${candidate}`),
    step: (next) => {
      candidate = next;
    },
  });

  used.add(candidate);
  return candidate;
});
