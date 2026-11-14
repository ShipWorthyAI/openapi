import {
  ParsedDiscriminator,
  ParsedSchema,
  collidingProperties,
  propertyName,
  schemaPropertyCollision,
  type ParsedBodyMediaType,
  type ParsedCallbackOperation,
  type ParsedHeader,
  type ParsedMediaType,
  type ParsedOperation,
  type ParsedParameter,
  type ParsedRequestBody,
  type ParsedResponse,
  type ParsedService,
} from "@shipworthy/openapi-transformer";
import {
  Array as Arr,
  Effect,
  JsonPointer,
  Option,
  pipe,
  Predicate,
  Record,
  Schema,
  String as Str,
} from "effect";
import type { CaseMapping, CaseOperation, CaseSchema } from "./types.ts";
import { compactCaseMapping } from "./prune.ts";
import { CaseMappingGenerationError } from "./errors.ts";

const isParsedSchema = Schema.is(ParsedSchema);
const decodeDiscriminator = Schema.decodeUnknownOption(ParsedDiscriminator);

function schemaEntries(value: unknown): Array<readonly [string, ParsedSchema]> {
  return Predicate.isObject(value)
    ? Arr.filter(Record.toEntries(value), (entry): entry is [string, ParsedSchema] =>
        isParsedSchema(entry[1]),
      )
    : [];
}

function schemaList(value: unknown): ParsedSchema[] {
  return Arr.filter(Arr.isArray(value) ? value : [], (entry): entry is ParsedSchema =>
    isParsedSchema(entry),
  );
}

function child(path: string, ...segments: readonly (string | number)[]): string {
  return Arr.reduce(
    segments,
    path,
    (result, segment) => `${result}/${JsonPointer.escapeToken(String(segment))}`,
  );
}

/** Index schema roots by their original JSON Pointers, including resolved component references. */
function schemaRoots(model: ParsedService): Map<string, ParsedSchema> {
  const roots = new Map<string, ParsedSchema>();

  const media = (entry: ParsedMediaType) => {
    if (entry.schema !== undefined) roots.set(child(entry.id, "schema"), entry.schema);
  };

  const namedValue = (entry: ParsedHeader) => {
    if (entry.schema !== undefined) roots.set(child(entry.id, "schema"), entry.schema);
    Arr.forEach(entry.contents, media);
  };

  const body = (entry: ParsedRequestBody) => Arr.forEach(entry.contents, media);

  const response = (entry: ParsedResponse) => {
    Arr.forEach(entry.contents, media);
    Arr.forEach(entry.headers, namedValue);
  };

  const operation = (entry: ParsedOperation | ParsedCallbackOperation) => {
    Arr.forEach(entry.request.path, namedValue);
    Arr.forEach(entry.request.query, namedValue);
    Arr.forEach(entry.request.headers, namedValue);
    Arr.forEach(entry.request.cookie, namedValue);
    if (entry.request.body) body(entry.request.body);
    Arr.forEach(entry.responses, response);
    if ("callbacks" in entry) Arr.forEach(entry.callbacks, operation);
  };

  Arr.forEach(Record.toEntries(model.components.schemas), ([name, schema]) =>
    roots.set(child("#/components/schemas", name), schema),
  );

  Arr.forEach(Record.toEntries(model.$defs), ([name, schema]) =>
    roots.set(child("#/$defs", name), schema),
  );

  Arr.forEach(Record.values(model.components.parameters), namedValue);
  Arr.forEach(Record.values(model.components.headers), namedValue);
  Arr.forEach(Record.values(model.components.requestBodies), body);
  Arr.forEach(Record.values(model.components.responses), response);

  Arr.forEach(Record.values(model.paths), (path) => {
    Arr.forEach(path.parameters, namedValue);
    Arr.forEach(path.operations, operation);
  });

  Arr.forEach(Record.values(model.webhooks), (path) => Arr.forEach(path.operations, operation));

  Arr.forEach(Record.values(model.components.pathItems), (path) =>
    Arr.forEach(path.operations, operation),
  );

  return roots;
}

function resolveSchema(
  roots: ReadonlyMap<string, ParsedSchema>,
  ref: string,
): ParsedSchema | undefined {
  if (!Str.startsWith("#/")(ref)) return undefined;

  let prefix = ref;

  while (Str.startsWith("#/")(prefix)) {
    const root = roots.get(prefix);

    if (root !== undefined) {
      const suffix = Str.slice(prefix.length)(ref);

      const segments = suffix
        ? Arr.map(pipe(suffix, Str.slice(1), Str.split("/")), JsonPointer.unescapeToken)
        : [];

      const resolved = Arr.reduce(segments, root as unknown, (value, segment) => {
        if (Arr.isArray(value)) return value[Number(segment)];
        return Predicate.isObject(value) ? value[segment] : undefined;
      });

      return isParsedSchema(resolved) ? resolved : undefined;
    }

    const slash = pipe(
      prefix,
      Str.lastIndexOf("/"),
      Option.getOrElse(() => -1),
    );

    prefix = Str.slice(0, slash)(prefix);
  }

  return undefined;
}

/** Discriminator mappings can declare fields on referenced variants without listing them there. */
function discriminatorFields(
  roots: ReadonlyMap<string, ParsedSchema>,
): ReadonlyMap<string, readonly string[]> {
  const fields = new Map<string, string[]>();
  const seen = new WeakSet<object>();

  const visit = (schema: ParsedSchema) => {
    if (!Predicate.isObject(schema) || seen.has(schema)) return;
    seen.add(schema);

    const discriminator = Option.getOrUndefined(decodeDiscriminator(schema.discriminator));

    if (discriminator && Arr.isArray(schema.oneOf)) {
      const references = [
        ...Arr.flatMap(schemaList(schema.oneOf), (item) =>
          Predicate.isObject(item) && Predicate.isString(item.$ref) ? [item.$ref] : [],
        ),
        ...Record.values(discriminator.mapping ?? {}),
      ];

      Arr.forEach(references, (ref) => {
        if (!Str.startsWith("#/")(ref)) return;
        const names = fields.get(ref) ?? [];

        if (!Arr.contains(names, discriminator.propertyName)) {
          fields.set(ref, [...names, discriminator.propertyName]);
        }
      });
    }

    Arr.forEach(
      [
        ...Arr.map(schemaEntries(schema.properties), ([, nested]) => nested),
        ...Arr.map(schemaEntries(schema.patternProperties), ([, nested]) => nested),
        ...Arr.map(schemaEntries(schema.$defs), ([, nested]) => nested),
        ...schemaList(schema.allOf),
        ...schemaList(schema.anyOf),
        ...schemaList(schema.oneOf),
        ...schemaList(schema.prefixItems),
        ...(isParsedSchema(schema.items) ? [schema.items] : []),
        ...(isParsedSchema(schema.additionalProperties) ? [schema.additionalProperties] : []),
      ],
      visit,
    );
  };

  Arr.forEach(roots.values(), visit);
  return fields;
}

interface BuildContext {
  readonly roots: ReadonlyMap<string, ParsedSchema>;
  readonly discriminatorFields: ReadonlyMap<string, readonly string[]>;
  readonly schemas: Record<string, CaseSchema>;
}

const caseSchema = Effect.fnUntraced(function* (
  schema: ParsedSchema | undefined,
  path: string,
  context: BuildContext,
): Effect.fn.Return<CaseSchema, CaseMappingGenerationError> {
  if (!Predicate.isObject(schema)) return {};

  const ref = Predicate.isString(schema.$ref) ? schema.$ref : undefined;

  if (ref && !Record.has(context.schemas, ref)) {
    const target = resolveSchema(context.roots, ref);

    if (target === undefined) {
      return yield* new CaseMappingGenerationError({
        message: `${path}: Unresolved schema $ref ${ref}`,
      });
    }

    context.schemas[ref] = {};
    context.schemas[ref] = yield* caseSchema(target, ref, context);
  }

  const discriminator = Option.getOrUndefined(decodeDiscriminator(schema.discriminator));
  const declared = schemaEntries(schema.properties);

  const inherited = Arr.filter(
    context.discriminatorFields.get(path) ?? [],
    (name) => !Arr.some(declared, ([property]) => property === name),
  );

  const properties: Array<readonly [string, ParsedSchema]> = [
    ...declared,
    ...Arr.map(inherited, (name) => [name, true] as const),
    ...(discriminator &&
    !Arr.some(declared, ([name]) => name === discriminator.propertyName) &&
    !Arr.contains(inherited, discriminator.propertyName)
      ? [[discriminator.propertyName, true] as const]
      : []),
  ];

  const duplicate = schemaPropertyCollision(schema, (ref) => resolveSchema(context.roots, ref), [
    ...(context.discriminatorFields.get(path) ?? []),
    ...(discriminator ? [discriminator.propertyName] : []),
  ]);

  if (duplicate) {
    return yield* new CaseMappingGenerationError({
      message: `${path}: ${duplicate[0]} and ${duplicate[1]} both become ${propertyName(duplicate[0], true)}`,
    });
  }

  const fields = yield* Effect.forEach(properties, ([name, nested]) =>
    caseSchema(nested, child(path, "properties", name), context).pipe(
      Effect.map((built) => [name, { name: propertyName(name, true), schema: built }] as const),
    ),
  );

  const item = isParsedSchema(schema.items)
    ? yield* caseSchema(schema.items, child(path, "items"), context)
    : undefined;

  const additional = isParsedSchema(schema.additionalProperties)
    ? yield* caseSchema(schema.additionalProperties, child(path, "additionalProperties"), context)
    : undefined;

  const prefixItems = yield* Effect.forEach(schemaList(schema.prefixItems), (nested, index) =>
    caseSchema(nested, child(path, "prefixItems", index), context),
  );

  const patterns = yield* Effect.forEach(
    schemaEntries(schema.patternProperties),
    ([pattern, nested]) =>
      Effect.try({
        try: () => new RegExp(pattern),
        catch: () =>
          new CaseMappingGenerationError({ message: `${path}: Invalid pattern ${pattern}` }),
      }).pipe(
        Effect.flatMap(() =>
          caseSchema(nested, child(path, "patternProperties", pattern), context),
        ),
        Effect.map((built) => [pattern, built] as const),
      ),
  );

  const variants = yield* Effect.forEach(["allOf", "anyOf", "oneOf"] as const, (keyword) =>
    Effect.forEach(schemaList(schema[keyword]), (nested, index) =>
      caseSchema(nested, child(path, keyword, index), context),
    ),
  );

  return {
    ...(ref ? { ref } : {}),
    ...(fields.length ? { properties: Record.fromEntries(fields) } : {}),
    ...(item ? { items: item } : {}),
    ...(prefixItems.length ? { prefixItems } : {}),
    ...(additional ? { additionalProperties: additional } : {}),
    ...(patterns.length ? { patternProperties: Record.fromEntries(patterns) } : {}),
    ...(Arr.some(variants, (group) => group.length > 0) ? { variants: Arr.flatten(variants) } : {}),
  };
});

const parameterGroup = Effect.fnUntraced(function* (
  parameters: readonly ParsedParameter[],
  context: BuildContext,
): Effect.fn.Return<CaseSchema | undefined, CaseMappingGenerationError> {
  if (!parameters.length) return undefined;

  const duplicate = collidingProperties(
    Arr.map(parameters, (parameter) => parameter.name),
    true,
  );

  if (duplicate) {
    return yield* new CaseMappingGenerationError({
      message: `${parameters[0]?.id}: ${duplicate[0]} and ${duplicate[1]} both become ${propertyName(duplicate[0], true)}`,
    });
  }

  const fields = yield* Effect.forEach(parameters, (parameter) => {
    const schema =
      parameter.schema ??
      Option.getOrUndefined(
        Arr.findFirst(parameter.contents, (entry) => entry.mediaType === "application/json"),
      )?.schema;

    return caseSchema(schema, child(parameter.id, "schema"), context).pipe(
      Effect.map(
        (built) =>
          [parameter.name, { name: propertyName(parameter.name, true), schema: built }] as const,
      ),
    );
  });

  return { properties: Record.fromEntries(fields) };
});

const operationCaseMap = Effect.fnUntraced(function* (
  operation: ParsedOperation,
  context: BuildContext,
): Effect.fn.Return<CaseOperation, CaseMappingGenerationError> {
  const groups = {
    path: operation.request.path,
    query: operation.request.query,
    header: operation.request.headers,
    cookie: operation.request.cookie,
  } as const;

  const parameters = yield* Effect.forEach(Record.toEntries(groups), ([location, entries]) =>
    parameterGroup(entries, context).pipe(Effect.map((built) => [location, built] as const)),
  );

  const bodies = yield* Effect.forEach(operation.request.body?.contents ?? [], (media) =>
    caseSchema(media.schema, child(media.id, "schema"), context).pipe(
      Effect.map((built) => [media.mediaType, built] as const),
    ),
  );

  const responses = yield* Effect.forEach(operation.responses, (response) =>
    Effect.forEach(response.contents, (media: ParsedBodyMediaType) =>
      caseSchema(media.schema, child(media.id, "schema"), context).pipe(
        Effect.map((built) => [media.mediaType, built] as const),
      ),
    ).pipe(Effect.map((contents) => [response.code, Record.fromEntries(contents)] as const)),
  );

  return {
    parameters: Record.fromEntries(Arr.filter(parameters, ([, plan]) => plan !== undefined)),
    requestBodies: Record.fromEntries(bodies),
    responses: Record.fromEntries(responses),
  };
});

export const buildCaseMapping = Effect.fnUntraced(function* (
  model: ParsedService,
): Effect.fn.Return<CaseMapping, CaseMappingGenerationError> {
  const roots = schemaRoots(model);

  const context: BuildContext = {
    roots,
    discriminatorFields: discriminatorFields(roots),
    schemas: Object.create(null),
  };

  const operations = yield* Effect.forEach(model.operations, (operation) =>
    operationCaseMap(operation, context).pipe(
      Effect.map((mapping) => [`${operation.method} ${operation.path}`, mapping] as const),
    ),
  );

  return compactCaseMapping({
    schemas: context.schemas,
    operations: Record.fromEntries(operations),
  });
});
