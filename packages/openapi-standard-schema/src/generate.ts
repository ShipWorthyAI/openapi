import type { Generator } from "@shipworthy/openapi-generator";
import {
  camelCaseSchema,
  ParsedSchema,
  propertyName,
  schemaPropertyCollision,
  type ParsedService,
} from "@shipworthy/openapi-transformer";
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
  String,
  Struct,
} from "effect";
import { SchemaGenerationError } from "./errors.ts";
import {
  componentRoots,
  middlewareNames,
  middlewarePlan,
  middlewareSource,
  type MiddlewarePlan,
} from "./middleware.ts";

const sequential = { concurrency: 1, discard: true } as const;

const identifierPattern = /[A-Za-z_$][A-Za-z0-9_$]*/g;

type Pool = Record<string, JsonSchema.JsonSchema>;

const GeneratorOptions = Schema.Struct({
  camelCase: Schema.optionalKey(Schema.Boolean),
  validationMiddleware: Schema.optionalKey(Schema.Boolean),
});

/** A multi-document before it is checked to hold at least one schema. */
interface Assembled {
  readonly schemas: readonly JsonSchema.JsonSchema[];
  readonly definitions: Pool;
}

export const standardSchema: Generator<string, SchemaGenerationError> = {
  id: "standard-schema",
  generate: Effect.fnUntraced(function* (
    input: ParsedService,
    options: Readonly<Record<string, unknown>>,
  ): Effect.fn.Return<string, SchemaGenerationError> {
    const { camelCase, validationMiddleware } = yield* Schema.decodeEffect(GeneratorOptions)(
      options,
    ).pipe(
      Effect.mapError(() => new SchemaGenerationError({ message: "#: Invalid generator options" })),
    );

    const model = camelCase ? yield* camelCaseModel(input) : input;
    const names = Record.keys(model.components.schemas);
    // The middleware sees bodies as sent over the wire, so it always uses the API's field names.
    const middleware = validationMiddleware ? middlewarePlan(input) : undefined;

    return yield* Effect.gen(function* () {
      yield* assertNames(names, middleware);

      const document =
        middleware === undefined || !camelCase
          ? yield* assemble(model, names, middleware?.roots ?? [])
          : yield* withWireRoots(
              yield* assemble(model, names, []),
              yield* assemble(input, names, [...middleware.roots, ...componentRoots(middleware)]),
              names.length,
            );

      return yield* Array.match(document.schemas, {
        onEmpty: () =>
          Effect.succeed(middleware === undefined ? "" : emitMiddlewareOnly(middleware)),
        onNonEmpty: (schemas) =>
          pipe(
            importSchemas({ dialect: "draft-2020-12", schemas, definitions: document.definitions }),
            Effect.flatMap(compileSchemas),
            Effect.flatMap((code) =>
              emit(names, code, middleware && { plan: middleware, wire: camelCase === true }),
            ),
          ),
      });
    }).pipe(Effect.catchDefect((cause) => Effect.fail(failure(cause))));
  }),
};

/** Fail when a component export would reuse a name the middleware section declares. */
const assertNames = Effect.fnUntraced(function* (
  names: readonly string[],
  middleware: MiddlewarePlan | undefined,
): Effect.fn.Return<void, SchemaGenerationError> {
  if (middleware === undefined) return;
  const reserved = Array.findFirst(names, (name) => middlewareNames.has(name));

  if (Option.isSome(reserved))
    return yield* new SchemaGenerationError({
      message: `#/components/schemas/${reserved.value}: Cannot emit this name as a schema export`,
    });
});

/**
 * Appends the middleware roots of `wire` (the document assembled with the API's field names) to
 * `main`. Wire definitions get a `__wire_` prefix so they stay apart from the renamed ones.
 */
const withWireRoots = Effect.fnUntraced(function* (
  main: Assembled,
  wire: Assembled,
  components: number,
): Effect.fn.Return<Assembled, SchemaGenerationError> {
  const used = new Set(Record.keys(main.definitions));

  const renames = new Map(
    Array.map(Record.keys(wire.definitions), (key) => {
      const prefixed = `__wire_${key}`;
      const target = used.has(prefixed) ? uniqueAgainst(used, prefixed) : prefixed;
      used.add(target);
      return [key, target] as const;
    }),
  );

  const roots = Array.drop(wire.schemas, components);

  yield* Effect.forEach(
    [...Record.values(wire.definitions), ...roots],
    (schema) => rewriteDefKeys(schema, renames),
    sequential,
  );

  return {
    schemas: [...main.schemas, ...roots],
    definitions: {
      ...main.definitions,
      ...Record.mapKeys(wire.definitions, (key) => renames.get(key) ?? key),
    },
  };
});

/**
 * A copy of the model whose component and root `$defs` schemas use camelCase property names.
 * Fails when two wire names at one object level would become the same name.
 */
const camelCaseModel = Effect.fnUntraced(function* (
  model: ParsedService,
): Effect.fn.Return<ParsedService, SchemaGenerationError> {
  const prefix = "#/components/schemas/";

  const resolve = (ref: string): ParsedSchema | undefined => {
    const path = JsonPointer.parseUriFragment(ref);
    const name = path?.[2];

    return path?.length === 3 &&
      path[0] === "components" &&
      path[1] === "schemas" &&
      name !== undefined &&
      Record.has(model.components.schemas, name)
      ? model.components.schemas[name]
      : undefined;
  };

  const roots = [
    ...Array.map(
      Record.toEntries(model.components.schemas),
      ([name, schema]) => [`${prefix}${name}`, schema] as const,
    ),
    ...Array.map(
      Record.toEntries(model.$defs),
      ([name, schema]) => [`#/$defs/${name}`, schema] as const,
    ),
  ];

  yield* Effect.forEach(
    roots,
    Effect.fnUntraced(function* ([path, schema]) {
      const collision = schemaPropertyCollision(schema, resolve);
      if (!collision) return;
      const [a, b] = collision;

      return yield* new SchemaGenerationError({
        message: `${path}: ${a} and ${b} both become ${propertyName(a, true)}`,
      });
    }),
    sequential,
  );

  const renamed = Struct.evolve(model, {
    components: Struct.evolve({ schemas: Record.map(camelCaseSchema) }),
    $defs: Record.map(camelCaseSchema),
  });

  yield* Effect.forEach(
    [...Record.values(renamed.components.schemas), ...Record.values(renamed.$defs)],
    (schema) => visit(schema, dropObjectData),
    sequential,
  );

  return renamed;
});

/**
 * Effect types `default`, `example`, and `examples` as the schema's type. Their object values keep
 * the API's field names, so they no longer match a renamed schema. They are annotations only, so
 * drop them rather than emit code that does not type-check.
 */
function dropObjectData(schema: JsonSchema.JsonSchema): void {
  if (Predicate.isObject(schema.default)) delete schema.default;
  if (Predicate.isObject(schema.example)) delete schema.example;

  if (Array.isArray(schema.examples) && Array.some(schema.examples, Predicate.isObject))
    delete schema.examples;
}

/** The module when the middleware has no schemas to validate with. */
function emitMiddlewareOnly(middleware: MiddlewarePlan): string {
  return `${middlewareSource(
    middleware,
    () => "",
    (name) => name,
  )}\n`;
}

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

function failure(cause: unknown): SchemaGenerationError {
  if (Schema.is(SchemaGenerationError)(cause)) return cause;

  return new SchemaGenerationError({
    message: Predicate.isError(cause) ? cause.message : globalThis.String(cause),
    cause,
  });
}

const decodeSchema = Schema.decodeUnknownResult(ParsedSchema);
const decodeSchemaMap = Schema.decodeUnknownResult(Schema.Record(Schema.String, Schema.Unknown));
const decodeSchemaList = Schema.decodeUnknownResult(Schema.Array(Schema.Unknown));
const decodeReference = Schema.decodeUnknownResult(Schema.String);

/**
 * Component schemas as `$ref`s, then `extras` (inline roots such as body schemas), with every
 * definition they share in one pool.
 */
const assemble = Effect.fnUntraced(function* (
  model: ParsedService,
  names: readonly string[],
  extras: ReadonlyArray<{ readonly path: string; readonly schema: ParsedSchema }>,
): Effect.fn.Return<Assembled, SchemaGenerationError> {
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

  const convertedExtras = yield* Effect.forEach(
    extras,
    ({ path, schema }) => prepare(schema, path, componentNames, rootRenames),
    { concurrency: 1 },
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
          ...Array.flatMap(
            [...convertedExtras, ...Array.map(convertedRoots, (root) => root.converted)],
            (document: JsonSchema.Document<"draft-2020-12">) => [
              document.schema,
              ...Record.values(document.definitions),
            ],
          ),
        ];

        yield* Effect.forEach(schemas, (schema) => rewriteDefKey(schema, key, target), sequential);
      } else {
        pool[key] = converted.schema;
      }
    }),
    sequential,
  );

  yield* Effect.forEach(
    [
      ...convertedComponents,
      ...convertedExtras,
      ...Array.map(convertedRoots, ({ converted }) => converted),
    ],
    (converted) => mergeDefinitions(pool, converted.definitions, converted.schema),
    sequential,
  );

  const extraSchemas = Array.map(convertedExtras, (converted) => converted.schema);
  const bindings = yield* bindComponents(pool, names, extraSchemas);

  return yield* Effect.try({
    try: () => ({
      schemas: [
        ...Array.map(names, (name) => ({ $ref: defRef(binding(bindings, name)) })),
        ...extraSchemas,
      ],
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
    Effect.flatMap(forbidExcludedKeys),
    Effect.flatMap(retargetComponentRefs(componentNames)),
    Effect.flatMap(retargetRootDefRefs(rootRenames)),
    Effect.flatMap((schema) =>
      Effect.try({ try: () => JsonSchema.fromSchemaOpenApi3_1(schema), catch: failure }),
    ),
  );
});

const decodeExclusions = Schema.decodeUnknownResult(
  Schema.Struct({
    anyOf: Schema.NonEmptyArray(Schema.Struct({ required: Schema.Tuple([Schema.String]) })),
  }),
);

/**
 * Effect cannot import `not`. Rewrites `{ not: { anyOf: [{ required: ["k"] }, …] } }`, which
 * forbids those keys, into `false` property schemas that reject them.
 */
const forbidExcludedKeys = Effect.fnUntraced(function* (schema: JsonSchema.JsonSchema) {
  return yield* visit(schema, (record) => {
    const keys = Record.keys<string, unknown>(record);
    if (
      !Array.contains(keys, "not") ||
      Array.some(keys, (key) => key !== "not" && !isAnnotation(key))
    )
      return;

    const exclusions = decodeExclusions(record.not);
    if (Result.isFailure(exclusions) || Record.keys(record.not ?? {}).length !== 1) return;
    delete record.not;
    record.type = "object";

    record.properties = Record.fromEntries(
      Array.map(exclusions.success.anyOf, ({ required: [key] }) => [key, false] as const),
    );
  }).pipe(Effect.as(schema));
});

const annotations = new Set([
  "title",
  "description",
  "example",
  "examples",
  "deprecated",
  "readOnly",
  "writeOnly",
  "$comment",
  "externalDocs",
  "xml",
]);

function isAnnotation(key: string): boolean {
  return annotations.has(key) || pipe(key, String.startsWith("x-"));
}

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
      if (!Record.has(pool, name)) {
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
  extras: readonly JsonSchema.JsonSchema[],
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
    [...Record.values(pool), ...extras],
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
      if (target === undefined || (local !== undefined && Record.has(local, name))) return;
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
      (key) => Record.has<string, unknown>(schema, key),
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
  const encode = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

  const [leftJson, rightJson] = yield* Effect.all([
    left === undefined ? Effect.void : encode(left),
    encode(right),
  ]).pipe(Effect.mapError(failure));

  return leftJson === rightJson;
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
  middleware:
    | {
        readonly plan: MiddlewarePlan;
        /** Whether exports use camelCase, so component bodies need their own wire validators. */
        readonly wire: boolean;
      }
    | undefined,
): Effect.fn.Return<string, SchemaGenerationError> {
  const imports = Array.filterMap(code.artifacts, (artifact) =>
    Match.value(artifact).pipe(
      Match.when({ _tag: "Import" }, (artifact) => Result.succeed(artifact.importDeclaration)),
      Match.orElse(() => Result.failVoid),
    ),
  );

  if (!Array.some(imports, (line) => pipe(line, String.includes("Schema"))))
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

  const trailer =
    middleware === undefined
      ? []
      : [
          "",
          middlewareSource(
            middleware.plan,
            (root) =>
              standardSchemaOf(code, names.length + root, middleware.plan.roots[root]?.path),
            (name) => (middleware.wire ? `__openapiWireComponents.${name}` : name),
            middleware.wire
              ? Array.map(
                  middleware.plan.components,
                  (name, index) =>
                    [
                      name,
                      standardSchemaOf(
                        code,
                        names.length + middleware.plan.roots.length + index,
                        `#/components/schemas/${name}`,
                      ),
                    ] as const,
                )
              : [],
          ),
        ];

  return `${Array.join(
    [
      ...imports,
      ...artifacts,
      ...types,
      ...declarations,
      ...bodies,
      ...Array.flatten(exports),
      ...trailer,
    ],
    "\n",
  )}\n`;
});

/** `Schema.toStandardSchemaV1(...)` around the generated code at `index`. */
function standardSchemaOf(
  code: SchemaRepresentation.CodeDocument,
  index: number,
  path: string | undefined,
): string {
  const body = code.codes[index];
  if (!body) throw new SchemaGenerationError({ message: `Missing generated schema for ${path}` });
  return `Schema.toStandardSchemaV1(${body.runtime})`;
}

function forwardReferenced(
  nonRecursives: readonly { readonly code: SchemaRepresentation.Code }[],
  recursives: readonly (readonly [string, SchemaRepresentation.Code])[],
): Set<string> {
  const names = new Set(Array.map(recursives, ([name]) => name));
  const indexes = new Map(Array.map(recursives, ([name], index) => [name, index]));

  const scan = (runtime: string, accept: (name: string) => boolean) =>
    pipe(
      Array.fromIterable(pipe(runtime, String.matchAll(identifierPattern))),
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
