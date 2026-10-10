import { ParsedSchema, type ParsedService } from "@shipworthy/openapi-transformer";
import { Array, Effect, Option, Order, Predicate, Record, Schema, pipe } from "effect";
import * as z from "zod";
import { ZodGenerationError } from "./errors.ts";
import { assertExportName } from "./names.ts";
import { resolveDocumentRef } from "./refs.ts";
import type { OperationRoute } from "./routes.ts";

type JsonSchema = Exclude<ParsedSchema, boolean>;

const schemaMaps = ["properties", "patternProperties"] as const;
const compositions = ["allOf", "anyOf", "oneOf"] as const;
const schemaFields = ["items", "additionalProperties", "propertyNames", "contains"] as const;

const annotations = new Set([
  "title",
  "description",
  "default",
  "example",
  "examples",
  "deprecated",
  "readOnly",
  "writeOnly",
  "$comment",
  "externalDocs",
  "xml",
]);

const untypedKeywords = new Set(["enum", "const", "allOf", "anyOf", "oneOf"]);

const keywords = new Set<string>([
  "$ref",
  "type",
  "enum",
  "const",
  ...schemaMaps,
  ...compositions,
  ...schemaFields,
  "not",
  "required",
  "dependentRequired",
  "minProperties",
  "maxProperties",
  "prefixItems",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minContains",
  "maxContains",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
]);

/**
 * One module: compiled Zod schemas for each component schema and each JSON
 * request body (`<operationId>RequestBody`), plus the shared JSON Schema they use.
 */
export type ZodSource = string;

interface SchemaExport {
  name: string;
  schema: ParsedSchema;
  /** The `./types` export that `type` reads from. */
  types: "components" | "operations";
  /** TypeScript type that the validator parses to. */
  type: string;
  expression?: string;
}

function isAnnotation(key: string): boolean {
  return annotations.has(key) || key.startsWith("x-");
}

const encodeJson = Effect.fnUntraced(function* (value: unknown) {
  return yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(value).pipe(
    Effect.mapError((cause) => new ZodGenerationError({ message: cause.message, cause })),
  );
});

const asSchema = Effect.fnUntraced(function* (value: unknown, path: string) {
  return yield* Schema.decodeUnknownEffect(ParsedSchema)(value).pipe(
    Effect.mapError(() => new ZodGenerationError({ message: `${path}: Expected a JSON schema` })),
  );
});

const schemaMap = Effect.fnUntraced(function* (value: unknown, path: string, keyword: string) {
  return yield* Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Unknown))(
    value,
  ).pipe(
    Effect.mapError(() => new ZodGenerationError({ message: `${path}: Unsupported ${keyword}` })),
    Effect.flatMap((values) =>
      Effect.forEach(Record.toEntries(values), ([name, part]) =>
        asSchema(part, `${path}/${keyword}/${name}`).pipe(
          Effect.map((schema) => [name, schema] as const),
        ),
      ),
    ),
    Effect.map(Record.fromEntries),
  );
});

const schemaList = Effect.fnUntraced(function* (value: unknown, path: string, keyword: string) {
  return yield* Schema.decodeUnknownEffect(Schema.Array(Schema.Unknown))(value).pipe(
    Effect.mapError(() => new ZodGenerationError({ message: `${path}: Unsupported ${keyword}` })),
    Effect.flatMap((values) =>
      Effect.forEach(values, (part, index) => asSchema(part, `${path}/${keyword}/${index}`)),
    ),
  );
});

function definitionSchema(schema: ParsedSchema): JsonSchema {
  if (schema === true) return {};
  if (schema === false) return { not: {} };
  return schema;
}

function isSingleRequiredKey(part: ParsedSchema): part is JsonSchema & { required: string[] } {
  return (
    Predicate.isObject(part) &&
    Record.keys<string, unknown>(part).length === 1 &&
    Array.isArray(part.required) &&
    part.required.length === 1 &&
    Predicate.isString(part.required[0])
  );
}

function indent(value: string, spaces: number): string {
  const pad = " ".repeat(spaces);

  return pipe(
    value.split("\n"),
    Array.map((line) => (line.length === 0 ? line : pad + line)),
    Array.join("\n"),
  );
}

function schemaLiteral(
  schema: ParsedSchema,
  names: readonly string[],
  expression?: string,
): string {
  if (names.length === 0) return expression ?? JSON.stringify(schema, null, 2);

  const defs = indent(
    pipe(
      names,
      Array.map((name) => `${JSON.stringify(name)}: definitions.${name}`),
      Array.join(",\n"),
    ),
    4,
  );

  if (expression) return `{\n  ...${expression},\n  $defs: {\n${defs}\n  },\n}`;
  const json = JSON.stringify(schema, null, 2);
  if (!json.startsWith("{\n")) return `{\n  $defs: {\n${defs}\n  },\n}`;
  return `{\n${json.slice(2, -2)},\n  $defs: {\n${defs}\n  },\n}`;
}

const definitionName = Effect.fnUntraced(function* (
  ref: string,
): Effect.fn.Return<string, ZodGenerationError> {
  const marker = "#/$defs/";
  if (!ref.startsWith(marker))
    return yield* new ZodGenerationError({ message: `${ref}: Reference not found` });
  return ref.slice(marker.length).replaceAll("~1", "/").replaceAll("~0", "~");
});

const objectProperties = Effect.fnUntraced(function* (
  document: ParsedService,
  schema: ParsedSchema,
  path: string,
  seen: ReadonlySet<string>,
): Effect.fn.Return<Record<string, ParsedSchema>, ZodGenerationError> {
  if (typeof schema === "boolean") return {};

  if (Predicate.isString(schema.$ref) && schema.$ref) {
    const ref = schema.$ref;
    if (seen.has(ref)) return {};

    const resolved = yield* resolveDocumentRef(document, ref).pipe(
      Effect.flatMap((value) => asSchema(value, ref)),
    );

    return yield* objectProperties(document, resolved, path, new Set([...seen, schema.$ref]));
  }

  const parts = yield* schemaList(schema.allOf ?? [], path, "allOf");

  const inherited = yield* Effect.forEach(parts, (part, index) =>
    objectProperties(document, part, `${path}/allOf/${index}`, seen),
  );

  const properties = schema.properties
    ? yield* schemaMap(schema.properties, path, "properties")
    : {};

  return {
    ...Array.reduce(inherited, {}, (merged, part) => ({ ...merged, ...part })),
    ...properties,
  };
});

const normalize = Effect.fnUntraced(function* (
  document: ParsedService,
  schema: ParsedSchema,
  path: string,
  inherited: Record<string, ParsedSchema> = {},
): Effect.fn.Return<JsonSchema, ZodGenerationError> {
  // `true` and `false` are the same as `{}` and `{ not: {} }` once Zod converts them.
  if (typeof schema === "boolean") return definitionSchema(schema);

  const unsupported = Array.findFirst(
    Record.keys<string, unknown>(schema),
    (key) => !keywords.has(key) && !isAnnotation(key),
  );

  if (Option.isSome(unsupported))
    return yield* new ZodGenerationError({
      message: `${path}: Unsupported keyword ${unsupported.value}`,
    });

  const result: JsonSchema = { ...schema };
  delete result.default;

  const properties = {
    ...inherited,
    ...(yield* objectProperties(document, schema, path, new Set())),
  };

  if (schema.$ref) {
    if (!Predicate.isString(schema.$ref) || !schema.$ref.startsWith("#/components/schemas/")) {
      const ref = Predicate.isString(schema.$ref) ? schema.$ref : yield* encodeJson(schema.$ref);

      return yield* new ZodGenerationError({
        message: `${path}: Unsupported schema reference ${ref}`,
      });
    }

    yield* resolveDocumentRef(document, schema.$ref);

    const sibling = Array.findFirst(
      Record.keys<string, unknown>(schema),
      (key) => key !== "$ref" && !isAnnotation(key),
    );

    if (Option.isSome(sibling))
      return yield* new ZodGenerationError({
        message: `${path}: Zod does not preserve ${sibling.value} alongside $ref`,
      });

    result.$ref = `#/$defs/${schema.$ref.slice("#/components/schemas/".length)}`;
    return result;
  }

  // In an object intersection, not(anyOf(required(single key))) forbids those keys.
  // Zod only accepts `not: {}` (never), so the forbidden keys become `false` schemas.
  if (schema.not !== undefined) {
    const notSchema = schema.not;
    const exclusions = Predicate.isObject(notSchema) ? notSchema.anyOf : undefined;

    const onlyNot = Array.every(
      Record.keys<string, unknown>(schema),
      (key) => key === "not" || isAnnotation(key),
    );

    if (
      !Array.isArray(exclusions) ||
      !Predicate.isObject(notSchema) ||
      Record.keys(notSchema).length !== 1 ||
      Record.keys(properties).length === 0 ||
      !onlyNot
    ) {
      return yield* new ZodGenerationError({ message: `${path}: Unsupported not constraint` });
    }

    const forbidden = yield* Effect.forEach(
      exclusions,
      Effect.fnUntraced(function* (part) {
        const key = yield* asSchema(part, path);
        if (!isSingleRequiredKey(key) || !key.required[0])
          return yield* new ZodGenerationError({ message: `${path}: Unsupported not constraint` });
        return [key.required[0], false] as const;
      }),
    ).pipe(Effect.map(Record.fromEntries));

    delete result.not;
    result.type = "object";
    result.properties = forbidden;
    return result;
  }

  // Zod rejects dependentRequired. Each entry becomes an allOf branch that either
  // forbids the trigger key or requires it with its dependencies.
  if (schema.dependentRequired !== undefined) {
    if (!Predicate.isObject(schema.dependentRequired)) {
      return yield* new ZodGenerationError({ message: `${path}: Unsupported dependentRequired` });
    }

    const branches = yield* Effect.forEach(
      Record.toEntries(schema.dependentRequired),
      ([name, value]) =>
        Schema.decodeUnknownEffect(Schema.Array(Schema.String))(value).pipe(
          Effect.mapError(
            () => new ZodGenerationError({ message: `${path}: Unsupported dependentRequired` }),
          ),
          Effect.map((dependencies): ParsedSchema => ({
            anyOf: [
              { not: { anyOf: [{ required: [name] }] } },
              { required: [name, ...dependencies] },
            ],
          })),
        ),
    );

    delete result.dependentRequired;
    result.allOf = [...(yield* schemaList(result.allOf ?? [], path, "allOf")), ...branches];
  }

  // Zod ignores required-only allOf branches. Copy the property schemas they inherit.
  if (schema.required && !schema.type) {
    const required = yield* Schema.decodeUnknownEffect(Schema.Array(Schema.String))(
      schema.required,
    ).pipe(
      Effect.mapError(
        () => new ZodGenerationError({ message: `${path}: Unsupported required constraint` }),
      ),
    );

    result.type = "object";

    const props = yield* Effect.forEach(
      required,
      Effect.fnUntraced(function* (name) {
        const property = properties[name];
        if (property === undefined)
          return yield* new ZodGenerationError({
            message: `${path}: Cannot resolve required property ${name}`,
          });
        return [name, property] as const;
      }),
    ).pipe(Effect.map(Record.fromEntries));

    result.properties = {
      ...(schema.properties ? yield* schemaMap(schema.properties, path, "properties") : {}),
      ...props,
    };
  }

  if (
    !result.type &&
    Array.some(
      Record.keys<string, unknown>(schema),
      (key) => keywords.has(key) && !untypedKeywords.has(key),
    )
  ) {
    return yield* new ZodGenerationError({
      message: `${path}: Constraints without a type are not supported by Zod`,
    });
  }

  yield* Effect.forEach(
    schemaMaps,
    Effect.fnUntraced(function* (key) {
      const values = result[key];
      if (!values) return;
      const schemas = yield* schemaMap(values, path, key);

      result[key] = yield* Effect.forEach(Record.toEntries(schemas), ([name, value]) =>
        normalize(document, value, `${path}/${key}/${name}`).pipe(
          Effect.map((schema) => [name, schema] as const),
        ),
      ).pipe(Effect.map(Record.fromEntries));
    }),
    { discard: true },
  );

  yield* Effect.forEach(
    compositions,
    Effect.fnUntraced(function* (key) {
      const values = result[key];
      if (!values) return;
      const schemas = yield* schemaList(values, path, key);

      result[key] = yield* Effect.forEach(schemas, (part, index) =>
        normalize(document, part, `${path}/${key}/${index}`, properties),
      );
    }),
    { discard: true },
  );

  if (result.prefixItems) {
    const schemas = yield* schemaList(result.prefixItems, path, "prefixItems");

    result.prefixItems = yield* Effect.forEach(schemas, (part, index) =>
      normalize(document, part, `${path}/prefixItems/${index}`),
    );
  }

  yield* Effect.forEach(
    schemaFields,
    Effect.fnUntraced(function* (key) {
      const value = result[key];
      if (value === undefined) return;
      if (Array.isArray(value))
        return yield* new ZodGenerationError({
          message: `${path}: Tuple items require prefixItems`,
        });

      result[key] = yield* asSchema(value, `${path}/${key}`).pipe(
        Effect.flatMap((schema) => normalize(document, schema, `${path}/${key}`)),
      );
    }),
    { discard: true },
  );

  return result;
});

const visit = Effect.fnUntraced(function* (
  schema: ParsedSchema,
  needed: Set<string>,
  definitions: ReadonlyMap<string, JsonSchema>,
): Effect.fn.Return<void, ZodGenerationError> {
  if (typeof schema === "boolean") return;

  if (Predicate.isString(schema.$ref) && schema.$ref) {
    const name = yield* definitionName(schema.$ref);

    if (!needed.has(name)) {
      const definition = definitions.get(name);
      if (definition === undefined)
        return yield* new ZodGenerationError({ message: `${schema.$ref}: Reference not found` });
      needed.add(name);
      yield* visit(definition, needed, definitions);
    }
  }

  yield* Effect.forEach(
    schemaMaps,
    Effect.fnUntraced(function* (key) {
      const values = schema[key];
      if (!Predicate.isObject(values)) return;

      yield* Effect.forEach(
        Record.values(values),
        (part) =>
          asSchema(part, "schema").pipe(
            Effect.flatMap((child) => visit(child, needed, definitions)),
          ),
        { discard: true },
      );
    }),
    { discard: true },
  );

  yield* Effect.forEach(
    [...compositions, "prefixItems"] as const,
    Effect.fnUntraced(function* (key) {
      const values = schema[key];
      if (!Array.isArray(values)) return;

      yield* Effect.forEach(
        values,
        (part) =>
          asSchema(part, "schema").pipe(
            Effect.flatMap((child) => visit(child, needed, definitions)),
          ),
        { discard: true },
      );
    }),
    { discard: true },
  );

  yield* Effect.forEach(
    schemaFields,
    Effect.fnUntraced(function* (key) {
      const value = schema[key];

      if (value !== undefined && !Array.isArray(value)) {
        yield* asSchema(value, "schema").pipe(
          Effect.flatMap((child) => visit(child, needed, definitions)),
        );
      }
    }),
    { discard: true },
  );
});

const compileExport = Effect.fnUntraced(function* (name: string, root: ParsedSchema) {
  return yield* Effect.try({
    try: () => {
      z.compile(z.fromJSONSchema(root));
    },
    catch: (cause) =>
      new ZodGenerationError({
        message: `${name}: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      }),
  });
});

function renderSource(
  entries: readonly SchemaExport[],
  definitions: ReadonlyMap<string, JsonSchema>,
  exports: readonly string[],
): ZodSource {
  if (exports.length === 0) return "";

  const types = pipe(
    entries,
    Array.map((entry) => entry.types),
    Array.dedupe,
    Array.sort(Order.String),
  );

  const blocks = [
    Array.join(
      [
        `import * as z from "zod";`,
        ...(types.length > 0 ? [`import type { ${Array.join(types, ", ")} } from "./types";`] : []),
      ],
      "\n",
    ),
  ];

  if (definitions.size > 0) {
    const keys = pipe(
      Array.fromIterable(definitions.keys()),
      Array.map((name) => JSON.stringify(name)),
      Array.join(" | "),
    );

    const values = pipe(
      Array.fromIterable(definitions),
      Array.map(([name, schema]) => `${JSON.stringify(name)}: ${JSON.stringify(schema, null, 2)}`),
      Array.join(",\n"),
    );

    blocks.push(
      `const definitions: Record<${keys}, z.core.JSONSchema.JSONSchema> = {\n${indent(values, 2)},\n};`,
    );
  }

  return `${Array.join([...blocks, ...exports], "\n\n")}\n`;
}

const source = Effect.fnUntraced(function* (
  entries: readonly SchemaExport[],
  definitions: ReadonlyMap<string, JsonSchema>,
): Effect.fn.Return<ZodSource, ZodGenerationError> {
  const seen = new Set<string>();

  yield* Effect.forEach(
    entries,
    Effect.fnUntraced(function* ({ name }) {
      yield* assertExportName(name, ["z", "definitions"]);
      if (seen.has(name))
        return yield* new ZodGenerationError({ message: `${name}: Duplicate schema export` });
      seen.add(name);
    }),
    { discard: true },
  );

  return yield* Effect.forEach(
    entries,
    Effect.fnUntraced(function* ({ name, schema, type, expression }) {
      const needed = new Set<string>();
      yield* visit(schema, needed, definitions);
      const names = Array.sort(needed, Order.String);

      const defs = yield* Effect.forEach(
        names,
        Effect.fnUntraced(function* (definition) {
          const value = definitions.get(definition);
          if (value === undefined)
            return yield* new ZodGenerationError({
              message: `#/$defs/${definition}: Reference not found`,
            });
          return [definition, value] as const;
        }),
      ).pipe(Effect.map(Record.fromEntries));

      const root =
        typeof schema === "boolean"
          ? schema
          : { ...schema, ...(names.length > 0 ? { $defs: defs } : {}) };

      yield* compileExport(name, root);
      const argument = schemaLiteral(schema, names, expression);
      return `export const ${name} = z.compile(z.fromJSONSchema(${argument})) as z.ZodType<${type}>;`;
    }),
  ).pipe(Effect.map((exports) => renderSource(entries, definitions, exports)));
});

const compile = Effect.fnUntraced(function* (
  model: ParsedService,
  routes: Record<string, OperationRoute>,
): Effect.fn.Return<ZodSource, ZodGenerationError> {
  if (!model.openapi.startsWith("3.1."))
    return yield* new ZodGenerationError({ message: "Zod generation requires OpenAPI 3.1" });

  if (model.jsonSchemaDialect || Record.keys(model.$defs).length > 0) {
    return yield* new ZodGenerationError({
      message: "Zod generation does not support custom dialects or top-level $defs",
    });
  }

  const definitions = yield* Effect.forEach(
    Record.toEntries(model.components.schemas),
    ([name, schema]) =>
      normalize(model, schema, `#/components/schemas/${name}`).pipe(
        Effect.map((normalized) => [name, normalized] as const),
      ),
  ).pipe(Effect.map((entries) => new Map(entries)));

  const components = Array.map(Array.fromIterable(definitions), ([name, schema]): SchemaExport => ({
    name,
    schema,
    types: "components",
    type: `components["schemas"][${JSON.stringify(name)}]`,
    expression: `definitions.${name}`,
  }));

  const operations = yield* Effect.forEach(
    model.operations,
    Effect.fnUntraced(function* (operation): Effect.fn.Return<
      SchemaExport | undefined,
      ZodGenerationError
    > {
      const id = operation.operationId;
      if (!id || !Object.hasOwn(routes, id)) return;
      const location = `${operation.method} ${operation.path}`;
      const body = operation.request.body;
      if (!body) return;

      const content = Array.findFirst(
        body.contents,
        (entry) => entry.mediaType === "application/json",
      );

      if (body.contents.length !== 1 || Option.isNone(content)) {
        return yield* new ZodGenerationError({
          message: `${location}: Request bodies require a single application/json media type`,
        });
      }

      if (content.value.schema === undefined)
        return yield* new ZodGenerationError({
          message: `${location}: Request body has no schema`,
        });

      const idLiteral = yield* encodeJson(id);

      return {
        name: `${id}RequestBody`,
        types: "operations",
        type: `NonNullable<operations[${idLiteral}]["requestBody"]>["content"]["application/json"]`,
        schema: yield* normalize(model, content.value.schema, location),
      };
    }),
  ).pipe(Effect.map(Array.filter(Predicate.isNotUndefined)));

  return yield* source([...components, ...operations], definitions);
});

/**
 * Turn an OpenAPI 3.1 document into Zod source.
 *
 * Component schemas become named exports. JSON request bodies become
 * `<operationId>RequestBody` exports. Shared schemas stay as JSON Schema in a
 * module-local `definitions` object, and each validator includes only the
 * `$defs` it references.
 * Defaults are removed so parsing does not fill them in.
 *
 * `routes` selects which operations can produce a request-body validator.
 * `operationRoutes` builds that table from the document.
 */
export const zodSources = Effect.fn("zodSources")(function* (
  document: ParsedService,
  routes: Record<string, OperationRoute>,
): Effect.fn.Return<ZodSource, ZodGenerationError> {
  return yield* compile(document, routes);
});
