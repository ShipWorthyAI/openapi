import {
  camelCaseSchema,
  ParsedDiscriminator,
  ParsedSchema,
  propertyName,
  schemaPropertyCollision,
  type ParsedBodyMediaType,
  type ParsedComponents,
  type ParsedHeader,
  type ParsedMediaType,
  type ParsedOperation,
  type ParsedOperationResponse,
  type ParsedParameter,
  type ParsedRequest,
  type ParsedRequestBody,
  type ParsedResponse,
  type ParsedService,
} from "@shipworthy/openapi-transformer";
import {
  Array,
  Effect,
  Option,
  Order,
  Predicate,
  Record,
  Result,
  Schema,
  Struct,
  pipe,
} from "effect";
import { ZodGenerationError } from "./errors.ts";
import { assertExportName } from "./names.ts";
import { resolveDocumentRef } from "./refs.ts";
import type { OperationRoute } from "./routes.ts";
import { loadZod } from "./zod.ts";

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

const untypedKeywords = new Set(["enum", "const", "allOf", "anyOf", "oneOf", "discriminator"]);

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
  "discriminator",
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
  discriminatorDiagnostics?: DiscriminatorDiagnostics;
}

interface DiscriminatorDiagnostics {
  readonly propertyName: string;
  readonly branchCount: number;
  readonly branchIndices: readonly (readonly [string, number])[];
}

interface DiscriminatorConstraint {
  readonly propertyName: string;
  readonly values: readonly string[];
}

type DiscriminatorConstraints = Map<string, DiscriminatorConstraint | null>;

const discriminatorOf = Effect.fnUntraced(function* (value: unknown, path: string) {
  if (value === undefined) return undefined;

  return yield* Schema.decodeUnknownEffect(ParsedDiscriminator)(value).pipe(
    Effect.mapError(
      () => new ZodGenerationError({ message: `${path}: Unsupported discriminator` }),
    ),
  );
});

function schemaName(ref: string): string | undefined {
  const prefix = "#/components/schemas/";
  if (!ref.startsWith(prefix)) return undefined;
  const token = ref.slice(prefix.length);
  if (!token || token.includes("/")) return undefined;
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

function componentRef(name: string): string {
  return `#/components/schemas/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

function discriminatorValues(discriminator: ParsedDiscriminator, ref: string): readonly string[] {
  const name = schemaName(ref);
  if (name === undefined) return [];

  const mapped = pipe(
    Record.toEntries(discriminator.mapping ?? {}),
    Array.filter(([, target]) => target === ref || target === name),
    Array.map(([value]) => value),
  );

  if (mapped.length > 0) return mapped;
  return Object.hasOwn(discriminator.mapping ?? {}, name) ? [] : [name];
}

const branchValues = Effect.fnUntraced(function* (
  discriminator: ParsedDiscriminator,
  ref: string,
  path: string,
): Effect.fn.Return<readonly string[], ZodGenerationError> {
  const values = discriminatorValues(discriminator, ref);
  if (values.length === 0)
    return yield* new ZodGenerationError({
      message: `${path}: Discriminator branch has no unique value`,
    });
  return values;
});

const discriminatorDiagnostics = Effect.fnUntraced(function* (
  schema: ParsedSchema,
  path: string,
): Effect.fn.Return<DiscriminatorDiagnostics | undefined, ZodGenerationError> {
  if (typeof schema === "boolean") return;
  const discriminator = yield* discriminatorOf(schema.discriminator, path);
  if (!discriminator) return;

  const key =
    schema.oneOf !== undefined && schema.anyOf === undefined
      ? "oneOf"
      : schema.anyOf !== undefined && schema.oneOf === undefined
        ? "anyOf"
        : undefined;

  if (!key) return;

  const parts = yield* schemaList(schema[key], path, key);

  const branchIndices = yield* Effect.forEach(
    parts,
    Effect.fnUntraced(function* (part, index) {
      const ref = Predicate.isObject(part) ? part.$ref : undefined;
      const branchPath = `${path}/${key}/${index}`;
      if (!Predicate.isString(ref) || schemaName(ref) === undefined)
        return yield* new ZodGenerationError({
          message: `${branchPath}: Discriminator branch requires a component schema reference`,
        });

      const values = yield* branchValues(discriminator, ref, branchPath);
      return Array.map(values, (value) => [value, index] as const);
    }),
  );

  return {
    propertyName: discriminator.propertyName,
    branchCount: parts.length,
    branchIndices: Array.flatten(branchIndices),
  };
});

const addDiscriminatorConstraint = Effect.fnUntraced(function* (
  constraints: DiscriminatorConstraints,
  ref: string,
  propertyName: string,
  values: readonly string[],
): Effect.fn.Return<void> {
  yield* Effect.sync(() => {
    const existing = constraints.get(ref);
    if (existing === null) return;

    if (existing && existing.propertyName !== propertyName) {
      constraints.set(ref, null);
      return;
    }

    constraints.set(ref, {
      propertyName,
      values: existing ? Array.dedupe([...existing.values, ...values]) : values,
    });
  });
});

function discriminatorValue(values: readonly string[]): ParsedSchema {
  return { type: "string", enum: [...values] };
}

function discriminatorConstraint(propertyName: string, values: readonly string[]): JsonSchema {
  return {
    type: "object",
    required: [propertyName],
    properties: { [propertyName]: discriminatorValue(values) },
  };
}

const discriminatorBranch = Effect.fnUntraced(function* (
  part: ParsedSchema,
  discriminator: ParsedDiscriminator,
  path: string,
): Effect.fn.Return<ParsedSchema, ZodGenerationError> {
  const ref = Predicate.isObject(part) ? part.$ref : undefined;
  if (!Predicate.isString(ref) || schemaName(ref) === undefined)
    return yield* new ZodGenerationError({
      message: `${path}: Discriminator branch requires a component schema reference`,
    });

  const values = yield* branchValues(discriminator, ref, path);

  return {
    allOf: [part, discriminatorConstraint(discriminator.propertyName, values)],
  };
});

const constrainComponent = Effect.fnUntraced(function* (
  schema: ParsedSchema,
  constraint: DiscriminatorConstraint | null | undefined,
  path: string,
): Effect.fn.Return<ParsedSchema, ZodGenerationError> {
  if (!constraint) return schema;
  if (typeof schema === "boolean")
    return yield* new ZodGenerationError({ message: `${path}: Unsupported discriminator target` });

  if (schema.allOf) {
    return {
      ...schema,
      allOf: [
        ...(yield* schemaList(schema.allOf, path, "allOf")),
        discriminatorConstraint(constraint.propertyName, constraint.values),
      ],
    };
  }

  if (schema.type !== "object")
    return yield* new ZodGenerationError({ message: `${path}: Unsupported discriminator target` });

  const properties = schema.properties
    ? yield* schemaMap(schema.properties, path, "properties")
    : {};

  if (properties[constraint.propertyName] !== undefined) {
    return {
      ...schema,
      allOf: [discriminatorConstraint(constraint.propertyName, constraint.values)],
    };
  }

  const required = schema.required
    ? yield* Schema.decodeUnknownEffect(Schema.Array(Schema.String))(schema.required).pipe(
        Effect.mapError(
          () => new ZodGenerationError({ message: `${path}: Unsupported required constraint` }),
        ),
      )
    : [];

  return {
    ...schema,
    required: Array.dedupe([...required, constraint.propertyName]),
    properties: {
      ...properties,
      [constraint.propertyName]: discriminatorValue(constraint.values),
    },
  };
});

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

const scanDiscriminatorSchema = Effect.fnUntraced(function* (
  schema: ParsedSchema,
  path: string,
  constraints: DiscriminatorConstraints,
  strict = true,
): Effect.fn.Return<void, ZodGenerationError> {
  if (typeof schema === "boolean") return;

  const discriminator = strict
    ? yield* discriminatorOf(schema.discriminator, path)
    : yield* discriminatorOf(schema.discriminator, path).pipe(
        Effect.orElseSucceed(() => undefined),
      );

  if (discriminator) {
    yield* Effect.forEach(
      ["oneOf", "anyOf"] as const,
      Effect.fnUntraced(function* (key) {
        if (!schema[key]) return;

        const parts = strict
          ? yield* schemaList(schema[key], path, key)
          : yield* schemaList(schema[key], path, key).pipe(Effect.orElseSucceed(() => []));

        yield* Effect.forEach(
          parts,
          Effect.fnUntraced(function* (part, index) {
            const ref = Predicate.isObject(part) ? part.$ref : undefined;
            const branchPath = `${path}/${key}/${index}`;

            if (!Predicate.isString(ref) || schemaName(ref) === undefined) {
              if (strict)
                return yield* new ZodGenerationError({
                  message: `${branchPath}: Discriminator branch requires a component schema reference`,
                });
              return;
            }

            const values = strict
              ? yield* branchValues(discriminator, ref, branchPath)
              : discriminatorValues(discriminator, ref);

            if (values.length === 0) return;

            yield* addDiscriminatorConstraint(constraints, ref, discriminator.propertyName, values);
          }),
          { discard: true },
        );
      }),
      { discard: true },
    );

    if (schema.oneOf || schema.anyOf) {
      yield* Effect.forEach(
        Record.values(discriminator.mapping ?? {}),
        Effect.fnUntraced(function* (target) {
          const ref = target.startsWith("#") ? target : componentRef(target);
          if (schemaName(ref) === undefined) return;

          yield* addDiscriminatorConstraint(
            constraints,
            ref,
            discriminator.propertyName,
            discriminatorValues(discriminator, ref),
          );
        }),
        { discard: true },
      );
    }
  }

  yield* Effect.forEach(
    schemaMaps,
    Effect.fnUntraced(function* (key) {
      if (!schema[key]) return;

      const values: Record<string, ParsedSchema> = strict
        ? yield* schemaMap(schema[key], path, key)
        : yield* schemaMap(schema[key], path, key).pipe(Effect.orElseSucceed(() => ({})));

      yield* Effect.forEach(
        Record.toEntries(values),
        ([name, part]) =>
          scanDiscriminatorSchema(part, `${path}/${key}/${name}`, constraints, strict),
        { discard: true },
      );
    }),
    { discard: true },
  );

  yield* Effect.forEach(
    [...compositions, "prefixItems"] as const,
    Effect.fnUntraced(function* (key) {
      if (!schema[key]) return;

      const parts = strict
        ? yield* schemaList(schema[key], path, key)
        : yield* schemaList(schema[key], path, key).pipe(Effect.orElseSucceed(() => []));

      yield* Effect.forEach(
        parts,
        (part, index) =>
          scanDiscriminatorSchema(part, `${path}/${key}/${index}`, constraints, strict),
        { discard: true },
      );
    }),
    { discard: true },
  );

  yield* Effect.forEach(
    [...schemaFields, "not"] as const,
    Effect.fnUntraced(function* (key) {
      if (schema[key] === undefined) return;
      if (Array.isArray(schema[key])) return;

      const part = strict
        ? yield* asSchema(schema[key], `${path}/${key}`)
        : yield* asSchema(schema[key], `${path}/${key}`).pipe(
            Effect.orElseSucceed(() => undefined),
          );

      if (part === undefined) return;
      yield* scanDiscriminatorSchema(part, `${path}/${key}`, constraints, strict);
    }),
    { discard: true },
  );
});

const scanContentSchemas = Effect.fnUntraced(function* (
  contents: readonly ParsedMediaType[],
  path: string,
  constraints: DiscriminatorConstraints,
  strict = false,
): Effect.fn.Return<void, ZodGenerationError> {
  yield* Effect.forEach(
    contents,
    (content) =>
      content.schema === undefined
        ? Effect.void
        : scanDiscriminatorSchema(
            content.schema,
            `${path}/${content.mediaType}`,
            constraints,
            strict,
          ),
    { discard: true },
  );
});

const scanHeaderSchemas = Effect.fnUntraced(function* (
  header: ParsedHeader,
  path: string,
  constraints: DiscriminatorConstraints,
): Effect.fn.Return<void, ZodGenerationError> {
  if (header.schema !== undefined)
    yield* scanDiscriminatorSchema(header.schema, `${path}/schema`, constraints, false);

  yield* scanContentSchemas(header.contents, `${path}/content`, constraints);
});

const scanDiscriminatorConstraints = Effect.fnUntraced(function* (
  model: ParsedService,
): Effect.fn.Return<ReadonlyMap<string, DiscriminatorConstraint | null>, ZodGenerationError> {
  const constraints: DiscriminatorConstraints = new Map();

  yield* Effect.forEach(
    Record.toEntries(model.components.schemas),
    ([name, schema]) => scanDiscriminatorSchema(schema, componentRef(name), constraints),
    { discard: true },
  );

  yield* Effect.forEach(
    model.operations,
    Effect.fnUntraced(function* (operation) {
      const location = `${operation.method} ${operation.path}`;

      yield* Effect.forEach(
        [
          ...operation.request.path,
          ...operation.request.query,
          ...operation.request.headers,
          ...operation.request.cookie,
        ],
        (parameter) =>
          scanHeaderSchemas(parameter, `${location}/parameters/${parameter.name}`, constraints),
        { discard: true },
      );

      if (operation.request.body)
        yield* scanContentSchemas(
          operation.request.body.contents,
          `${location}/requestBody`,
          constraints,
          true,
        );

      yield* Effect.forEach(
        operation.responses,
        Effect.fnUntraced(function* (response) {
          const responsePath = `${location}/responses/${response.code}`;
          yield* scanContentSchemas(response.contents, `${responsePath}/content`, constraints);

          yield* Effect.forEach(
            response.headers,
            (header) =>
              scanHeaderSchemas(header, `${responsePath}/headers/${header.name}`, constraints),
            { discard: true },
          );
        }),
        { discard: true },
      );
    }),
    { discard: true },
  );

  yield* Effect.forEach(
    Record.toEntries(model.components.requestBodies),
    ([name, body]) =>
      scanContentSchemas(body.contents, `#/components/requestBodies/${name}`, constraints),
    { discard: true },
  );

  yield* Effect.forEach(
    Record.toEntries(model.components.responses),
    Effect.fnUntraced(function* ([name, response]) {
      const responsePath = `#/components/responses/${name}`;
      yield* scanContentSchemas(response.contents, `${responsePath}/content`, constraints);

      yield* Effect.forEach(
        response.headers,
        (header) =>
          scanHeaderSchemas(header, `${responsePath}/headers/${header.name}`, constraints),
        { discard: true },
      );
    }),
    { discard: true },
  );

  yield* Effect.forEach(
    Record.toEntries(model.components.parameters),
    ([name, parameter]) =>
      scanHeaderSchemas(parameter, `#/components/parameters/${name}`, constraints),
    { discard: true },
  );

  yield* Effect.forEach(
    Record.toEntries(model.components.headers),
    ([name, header]) => scanHeaderSchemas(header, `#/components/headers/${name}`, constraints),
    { discard: true },
  );

  yield* Effect.forEach(
    Record.toEntries(model.components.schemas),
    Effect.fnUntraced(function* ([name, schema]) {
      if (typeof schema === "boolean" || !schema.allOf) return;
      const path = componentRef(name);
      const parts = yield* schemaList(schema.allOf, path, "allOf");

      yield* Effect.forEach(
        parts,
        Effect.fnUntraced(function* (part) {
          const ref = Predicate.isObject(part) ? part.$ref : undefined;
          if (!Predicate.isString(ref) || schemaName(ref) === undefined) return;

          const parent = yield* resolveDocumentRef(model, ref).pipe(
            Effect.flatMap((value) => asSchema(value, ref)),
          );

          const discriminator =
            typeof parent === "boolean"
              ? undefined
              : yield* discriminatorOf(parent.discriminator, ref);

          if (!discriminator) return;

          const values = yield* branchValues(discriminator, path, path);

          yield* addDiscriminatorConstraint(constraints, path, discriminator.propertyName, values);
        }),
        { discard: true },
      );
    }),
    { discard: true },
  );

  return constraints;
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
  delete result.discriminator;

  const discriminator = yield* discriminatorOf(schema.discriminator, path);

  if (discriminator) {
    yield* Effect.forEach(
      ["oneOf", "anyOf"] as const,
      Effect.fnUntraced(function* (key) {
        if (!result[key]) return;
        const parts = yield* schemaList(result[key], path, key);

        result[key] = yield* Effect.forEach(parts, (part, index) =>
          discriminatorBranch(part, discriminator, `${path}/${key}/${index}`),
        );
      }),
      { discard: true },
    );
  }

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

const compileExport = Effect.fnUntraced(function* (
  z: typeof import("zod"),
  name: string,
  root: ParsedSchema,
) {
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

const discriminatorIssueHelper = `function __openapiDiscriminatorIssues(
  schema: z.ZodType,
  propertyName: string,
  branchCount: number,
  branchIndices: ReadonlyMap<string, number>,
) {
  return z.unknown().transform((input, context) => {
    const parsed = schema.safeParse(input);
    if (parsed.success) return parsed.data;

    const tag =
      typeof input === "object" && input !== null && propertyName in input
        ? input[propertyName]
        : undefined;
    const index = typeof tag === "string" ? branchIndices.get(tag) : undefined;

    for (const issue of parsed.error.issues) {
      const selected =
        index !== undefined &&
        issue.code === "invalid_union" &&
        issue.path.length === 0 &&
        issue.errors.length === branchCount
          ? issue.errors[index]
          : undefined;

      if (selected && selected.length > 0) {
        for (const detail of selected) context.addIssue(detail);
      } else {
        context.addIssue(issue);
      }
    }

    return z.NEVER;
  });
}`;

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

  if (Array.some(entries, (entry) => entry.discriminatorDiagnostics !== undefined))
    blocks.push(discriminatorIssueHelper);

  return `${Array.join([...blocks, ...exports], "\n\n")}\n`;
}

const source = Effect.fnUntraced(function* (
  entries: readonly SchemaExport[],
  definitions: ReadonlyMap<string, JsonSchema>,
  outputPath?: string,
): Effect.fn.Return<ZodSource, ZodGenerationError> {
  const seen = new Set<string>();

  const hasDiscriminatorDiagnostics = Array.some(
    entries,
    (entry) => entry.discriminatorDiagnostics !== undefined,
  );

  yield* Effect.forEach(
    entries,
    Effect.fnUntraced(function* ({ name }) {
      yield* assertExportName(name, [
        "z",
        "definitions",
        ...(hasDiscriminatorDiagnostics ? ["__openapiDiscriminatorIssues"] : []),
      ]);

      if (seen.has(name))
        return yield* new ZodGenerationError({ message: `${name}: Duplicate schema export` });
      seen.add(name);
    }),
    { discard: true },
  );

  if (entries.length === 0) return "";
  const z = yield* loadZod(outputPath);

  return yield* Effect.forEach(
    entries,
    Effect.fnUntraced(function* ({ name, schema, type, expression, discriminatorDiagnostics }) {
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

      yield* compileExport(z, name, root);
      const argument = schemaLiteral(schema, names, expression);
      const compiled = `z.compile(z.fromJSONSchema(${argument}))`;

      let validator = compiled;

      if (discriminatorDiagnostics) {
        const { propertyName, branchIndices } = yield* Effect.all({
          propertyName: encodeJson(discriminatorDiagnostics.propertyName),
          branchIndices: encodeJson(discriminatorDiagnostics.branchIndices),
        });

        validator = `__openapiDiscriminatorIssues(${compiled}, ${propertyName}, ${discriminatorDiagnostics.branchCount}, new Map<string, number>(${branchIndices}))`;
      }

      return `export const ${name} = ${validator} as z.ZodType<${type}>;`;
    }),
  ).pipe(Effect.map((exports) => renderSource(entries, definitions, exports)));
});

const compile = Effect.fnUntraced(function* (
  model: ParsedService,
  routes: Record<string, OperationRoute>,
  outputPath?: string,
): Effect.fn.Return<ZodSource, ZodGenerationError> {
  if (!model.openapi.startsWith("3.1."))
    return yield* new ZodGenerationError({ message: "Zod generation requires OpenAPI 3.1" });

  if (model.jsonSchemaDialect || Record.keys(model.$defs).length > 0) {
    return yield* new ZodGenerationError({
      message: "Zod generation does not support custom dialects or top-level $defs",
    });
  }

  const constraints = yield* scanDiscriminatorConstraints(model);

  const prepared = yield* Effect.forEach(
    Record.toEntries(model.components.schemas),
    Effect.fnUntraced(function* ([name, schema]) {
      const path = componentRef(name);
      const constrained = yield* constrainComponent(schema, constraints.get(path), path);
      const normalized = yield* normalize(model, constrained, path);
      const diagnostics = yield* discriminatorDiagnostics(schema, path);
      return [name, normalized, diagnostics] as const;
    }),
  );

  const definitions = new Map(Array.map(prepared, ([name, schema]) => [name, schema] as const));

  const components = Array.map(prepared, ([name, schema, diagnostics]): SchemaExport => ({
    name,
    schema,
    types: "components",
    type: `components["schemas"][${JSON.stringify(name)}]`,
    expression: `definitions.${name}`,
    discriminatorDiagnostics: diagnostics,
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
        discriminatorDiagnostics: yield* discriminatorDiagnostics(content.value.schema, location),
      };
    }),
  ).pipe(Effect.map(Array.filter(Predicate.isNotUndefined)));

  return yield* source([...components, ...operations], definitions, outputPath);
});

/** The JSON request-body schema an operation exports as `<operationId>RequestBody`, if any. */
function exportedRequestBody(
  operation: ParsedOperation,
  routes: Record<string, OperationRoute>,
): ParsedSchema | undefined {
  const id = operation.operationId;
  if (!id || !Object.hasOwn(routes, id) || !operation.request.body) return undefined;
  const contents = operation.request.body.contents;
  const content = contents.length === 1 ? contents[0] : undefined;
  return content?.mediaType === "application/json" ? content.schema : undefined;
}

/** Fail when two wire names in one exported schema become the same camelCase name. */
const assertNoCamelCaseCollisions = Effect.fnUntraced(function* (
  model: ParsedService,
  routes: Record<string, OperationRoute>,
): Effect.fn.Return<void, ZodGenerationError> {
  const resolve = (ref: string): ParsedSchema | undefined => {
    const name = schemaName(ref);

    return name !== undefined && Object.hasOwn(model.components.schemas, name)
      ? model.components.schemas[name]
      : undefined;
  };

  const roots = [
    ...Array.map(
      Record.toEntries(model.components.schemas),
      ([name, schema]) => [componentRef(name), schema] as const,
    ),
    ...Array.filterMap(model.operations, (operation) => {
      const schema = exportedRequestBody(operation, routes);

      return schema === undefined
        ? Result.failVoid
        : Result.succeed([`${operation.method} ${operation.path}`, schema] as const);
    }),
  ];

  yield* Effect.forEach(
    roots,
    Effect.fnUntraced(function* ([path, schema]) {
      const collision = schemaPropertyCollision(schema, resolve);
      if (!collision) return;
      const [a, b] = collision;

      return yield* new ZodGenerationError({
        message: `${path}: ${a} and ${b} both become ${propertyName(a, true)}`,
      });
    }),
    { discard: true },
  );
});

const withCamelCaseSchema = {
  schema: (schema: ParsedSchema | undefined) =>
    schema === undefined ? undefined : camelCaseSchema(schema),
};

const withCamelCaseContents = {
  contents: Array.map((content: ParsedMediaType) => Struct.evolve(content, withCamelCaseSchema)),
};

const withCamelCaseBody = {
  contents: Array.map((content: ParsedBodyMediaType) =>
    Struct.evolve(content, withCamelCaseSchema),
  ),
};

function camelCaseHeader(header: ParsedHeader): ParsedHeader {
  return Struct.evolve(header, { ...withCamelCaseSchema, ...withCamelCaseContents });
}

function camelCaseParameter(parameter: ParsedParameter): ParsedParameter {
  return Struct.evolve(parameter, { ...withCamelCaseSchema, ...withCamelCaseContents });
}

const withCamelCaseResponse = { ...withCamelCaseBody, headers: Array.map(camelCaseHeader) };

function camelCaseRequest(request: ParsedRequest): ParsedRequest {
  return Struct.evolve(request, {
    path: Array.map(camelCaseParameter),
    query: Array.map(camelCaseParameter),
    headers: Array.map(camelCaseParameter),
    cookie: Array.map(camelCaseParameter),
    body: (body: ParsedRequest["body"]) =>
      body === undefined ? undefined : Struct.evolve(body, withCamelCaseBody),
  });
}

/**
 * A copy of the model whose schemas use camelCase property names, so validators parse the
 * shapes that camelCase `types.ts` declares. Every schema the generator reads is renamed,
 * including the response and parameter schemas scanned for discriminator constraints.
 */
function camelCaseModel(model: ParsedService): ParsedService {
  return Struct.evolve(model, {
    operations: Array.map((operation: ParsedOperation) =>
      Struct.evolve(operation, {
        request: camelCaseRequest,
        responses: Array.map((response: ParsedOperationResponse) =>
          Struct.evolve(response, withCamelCaseResponse),
        ),
      }),
    ),
    components: (components: ParsedComponents) =>
      Struct.evolve(components, {
        schemas: Record.map(camelCaseSchema),
        responses: Record.map((response: ParsedResponse) =>
          Struct.evolve(response, withCamelCaseResponse),
        ),
        parameters: Record.map(camelCaseParameter),
        headers: Record.map(camelCaseHeader),
        requestBodies: Record.map((body: ParsedRequestBody) =>
          Struct.evolve(body, withCamelCaseBody),
        ),
      }),
  });
}

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
 * Pass `outputPath` to validate with the Zod installation visible to the generated file.
 * Pass `camelCase: true` to rename snake_case properties to camelCase, matching `types.ts`
 * generated with `camelCase`. Two wire names that become the same name fail generation.
 */
export const zodSources = Effect.fn("zodSources")(function* (
  document: ParsedService,
  routes: Record<string, OperationRoute>,
  options: { readonly outputPath?: string; readonly camelCase?: boolean } = {},
): Effect.fn.Return<ZodSource, ZodGenerationError> {
  if (!options.camelCase) return yield* compile(document, routes, options.outputPath);
  yield* assertNoCamelCaseCollisions(document, routes);
  return yield* compile(camelCaseModel(document), routes, options.outputPath);
});
