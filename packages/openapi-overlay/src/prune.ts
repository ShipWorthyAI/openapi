import {
  OpenApiCallback,
  OpenApiExample,
  OpenApiHeader,
  OpenApiHttpMethod,
  OpenApiLink,
  OpenApiMediaType,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiPathItem,
  OpenApiRequestBody,
  OpenApiReference,
  OpenApiResponse,
  OpenApiSchema,
  OpenApiSecurityScheme,
  ParsedOpenApi,
} from "@shipworthy/openapi-parser/schemas/3.1";
import { Array, Effect, JsonPointer, pipe, Predicate, Record, Schema, String } from "effect";
import { OverlayError } from "./errors.ts";

const methods = OpenApiHttpMethod.literals;
const schemaWithAllOf = Schema.Struct({ allOf: Schema.Array(OpenApiSchema) });
const schemaMaps = ["properties", "patternProperties", "$defs", "dependentSchemas"];
const schemaLists = ["allOf", "anyOf", "oneOf", "prefixItems"];

const schemaSingles = [
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

type PruneError = OverlayError | Schema.SchemaError;
type Work = Effect.Effect<void, PruneError>;
type Visit = (value: unknown) => Work;

function extendsSchema(schema: OpenApiSchema, pointer: string): boolean {
  return (
    Schema.is(schemaWithAllOf)(schema) &&
    Array.some(
      schema.allOf,
      (child) => Schema.is(OpenApiReference)(child) && child.$ref === pointer,
    )
  );
}

function visitMap(
  values: Readonly<Record<string, unknown>> | undefined,
  visit: Visit,
  ignoreExtensions = false,
): Work {
  return Effect.forEach(
    Record.toEntries(values ?? {}),
    ([key, value]) =>
      ignoreExtensions && pipe(key, String.startsWith("x-")) ? Effect.void : visit(value),
    { discard: true },
  );
}

export const removeUnusedComponents = Effect.fnUntraced(
  function* (document: Schema.MutableJsonObject) {
    const parsed = yield* Schema.decodeUnknownEffect(ParsedOpenApi)(document);
    const used = new Set<string>();
    const followed = new Set<string>();
    const removedPaths = new Set<string>();
    const components = new Map<string, () => Work>();
    const operationIds = new Set<string>();
    const linkedOperationIds = new Set<string>();
    const inherited = new Set<string>();

    const componentPointer = (category: string, name: string) =>
      JsonPointer.formatUriFragment(["components", category, name]);

    const mark = Effect.fnUntraced(function* (
      category: string,
      name: string,
    ): Effect.fn.Return<void, PruneError> {
      const pointer = componentPointer(category, name);
      if (used.has(pointer)) return;
      const visit = components.get(pointer);
      if (visit === undefined)
        return yield* new OverlayError({ message: `Missing component ${pointer}` });
      used.add(pointer);
      yield* visit();
    });

    const reference = Effect.fnUntraced(function* (
      ref: string,
      visit: Visit,
    ): Effect.fn.Return<void, PruneError> {
      const tokens = pipe(ref, String.startsWith("#/"))
        ? JsonPointer.parseUriFragment(ref)
        : undefined;

      if (tokens === undefined)
        return yield* new OverlayError({
          message: `Component pruning requires bundled local JSON Pointer references: ${ref}`,
        });

      if (tokens[0] === "paths" && tokens[1] !== undefined && removedPaths.has(tokens[1]))
        return yield* new OverlayError({ message: `Reference targets a removed path: ${ref}` });

      const root: unknown = parsed;

      const target = Array.reduce(tokens, root, (value, token): unknown =>
        Predicate.isObject(value) && Record.has(value, token) ? value[token] : undefined,
      );

      if (target === undefined)
        return yield* new OverlayError({ message: `Missing reference ${ref}` });
      if (followed.has(ref)) return;
      followed.add(ref);
      if (tokens[0] === "components" && tokens[1] !== undefined && tokens[2] !== undefined)
        yield* mark(tokens[1], tokens[2]);
      yield* visit(target);
    });

    function referenced<S extends Schema.ConstraintDecoder<unknown, never>>(
      schema: S,
      walk: (value: S["Type"]) => Work,
    ): Visit {
      const visit = Effect.fnUntraced(function* (
        value: unknown,
      ): Effect.fn.Return<void, PruneError> {
        if (Predicate.isObject(value) && Predicate.isString(value.$ref)) {
          yield* reference(value.$ref, visit);
          return;
        }

        yield* walk(yield* Schema.decodeUnknownEffect(schema)(value));
      });

      return visit;
    }

    const visitSchema = Effect.fnUntraced(function* (
      value: unknown,
      componentName?: string,
    ): Effect.fn.Return<void, PruneError> {
      const schema = yield* Schema.decodeUnknownEffect(OpenApiSchema)(value);
      if (typeof schema === "boolean") return;
      if (Predicate.isString(schema.$ref)) yield* reference(schema.$ref, visitSchema);
      if (Predicate.isString(schema.$dynamicRef))
        return yield* new OverlayError({
          message: `Component pruning does not support $dynamicRef: ${schema.$dynamicRef}`,
        });

      yield* Effect.forEach(
        schemaSingles,
        (key) => (schema[key] === undefined ? Effect.void : visitSchema(schema[key])),
        { discard: true },
      );

      yield* Effect.forEach(
        schemaLists,
        (key) => {
          const children = schema[key];

          return Array.isArray(children)
            ? Effect.forEach(children, (child) => visitSchema(child), { discard: true })
            : Effect.void;
        },
        { discard: true },
      );

      yield* Effect.forEach(
        schemaMaps,
        (key) => {
          const children = schema[key];

          return Predicate.isObject(children)
            ? Effect.forEach(Record.values(children), (child) => visitSchema(child), {
                discard: true,
              })
            : Effect.void;
        },
        { discard: true },
      );

      const discriminator = schema.discriminator;
      if (Predicate.isObject(discriminator) && componentName !== undefined)
        yield* visitDerivedSchemas(componentName);
      if (Predicate.isObject(discriminator) && Predicate.isObject(discriminator.mapping))
        yield* Effect.forEach(
          Record.values(discriminator.mapping),
          (target) => {
            if (!Predicate.isString(target)) return Effect.void;

            return Record.has(parsed.components?.schemas ?? {}, target)
              ? mark("schemas", target)
              : reference(target, visitSchema);
          },
          { discard: true },
        );
    });

    function visitDerivedSchemas(parent: string): Work {
      if (inherited.has(parent)) return Effect.void;
      inherited.add(parent);
      const pointer = componentPointer("schemas", parent);

      return Effect.forEach(
        Record.toEntries(parsed.components?.schemas ?? {}),
        ([name, schema]) => {
          if (!extendsSchema(schema, pointer)) return Effect.void;
          return mark("schemas", name).pipe(Effect.andThen(() => visitDerivedSchemas(name)));
        },
        { discard: true },
      );
    }

    const visitExample = referenced(OpenApiExample, () => Effect.void);
    const visitSecurityScheme = referenced(OpenApiSecurityScheme, () => Effect.void);

    const visitHeader = referenced(
      OpenApiHeader,
      Effect.fnUntraced(function* (header) {
        if (header.schema !== undefined) yield* visitSchema(header.schema);
        yield* visitMap(header.content, visitMediaType);
        yield* visitMap(header.examples, visitExample);
      }),
    );

    const visitParameter = referenced(
      OpenApiParameter,
      Effect.fnUntraced(function* (parameter) {
        if (parameter.schema !== undefined) yield* visitSchema(parameter.schema);
        yield* visitMap(parameter.content, visitMediaType);
        yield* visitMap(parameter.examples, visitExample);
      }),
    );

    const visitRequestBody = referenced(OpenApiRequestBody, (body) =>
      visitMap(body.content, visitMediaType),
    );

    const visitLink = referenced(
      OpenApiLink,
      Effect.fnUntraced(function* (link) {
        if (link.operationId !== undefined) linkedOperationIds.add(link.operationId);
        if (link.operationRef !== undefined && pipe(link.operationRef, String.startsWith("#")))
          yield* reference(link.operationRef, visitOperation);
      }),
    );

    const visitResponse = referenced(
      OpenApiResponse,
      Effect.fnUntraced(function* (response) {
        yield* visitMap(response.content, visitMediaType);
        yield* visitMap(response.headers, visitHeader);
        yield* visitMap(response.links, visitLink);
      }),
    );

    const visitCallback = referenced(OpenApiCallback, (callback) =>
      visitMap(callback, visitPathItem, true),
    );

    function visitMediaType(value: unknown): Work {
      return Schema.decodeUnknownEffect(OpenApiMediaType)(value).pipe(
        Effect.flatMap(
          Effect.fnUntraced(function* (media) {
            if (media.schema !== undefined) yield* visitSchema(media.schema);
            yield* visitMap(media.examples, visitExample);

            yield* Effect.forEach(
              Record.values(media.encoding ?? {}),
              (encoding) => visitMap(encoding.headers, visitHeader),
              { discard: true },
            );
          }),
        ),
      );
    }

    function visitSecurity(security: OpenApiOperation["security"]): Work {
      return Effect.forEach(
        security ?? [],
        (requirement) =>
          Effect.forEach(Record.keys(requirement), (name) => mark("securitySchemes", name), {
            discard: true,
          }),
        { discard: true },
      );
    }

    function visitOperation(value: unknown): Work {
      return Schema.decodeUnknownEffect(OpenApiOperation)(value).pipe(
        Effect.flatMap(
          Effect.fnUntraced(function* (operation) {
            if (operation.operationId !== undefined) operationIds.add(operation.operationId);
            yield* Effect.forEach(operation.parameters ?? [], visitParameter, { discard: true });
            if (operation.requestBody !== undefined) yield* visitRequestBody(operation.requestBody);
            yield* visitMap(operation.responses, visitResponse, true);
            yield* visitMap(operation.callbacks, visitCallback);
            yield* visitSecurity(operation.security);
          }),
        ),
      );
    }

    function visitPathItem(value: unknown): Work {
      return Schema.decodeUnknownEffect(OpenApiPathItem)(value).pipe(
        Effect.flatMap(
          Effect.fnUntraced(function* (item) {
            if (item.$ref !== undefined) yield* reference(item.$ref, visitPathItem);
            yield* Effect.forEach(item.parameters ?? [], visitParameter, { discard: true });

            yield* Effect.forEach(
              methods,
              (method) => (item[method] === undefined ? Effect.void : visitOperation(item[method])),
              { discard: true },
            );
          }),
        ),
      );
    }

    function register(
      category: string,
      values: Readonly<Record<string, unknown>> | undefined,
      visit: Visit,
    ) {
      Array.forEach(Record.toEntries(values ?? {}), ([name, value]) => {
        components.set(componentPointer(category, name), () => visit(value));
      });
    }

    Array.forEach(Record.toEntries(parsed.components?.schemas ?? {}), ([name, schema]) => {
      components.set(componentPointer("schemas", name), () => visitSchema(schema, name));
    });

    register("responses", parsed.components?.responses, visitResponse);
    register("parameters", parsed.components?.parameters, visitParameter);
    register("requestBodies", parsed.components?.requestBodies, visitRequestBody);
    register("headers", parsed.components?.headers, visitHeader);
    register("examples", parsed.components?.examples, visitExample);
    register("links", parsed.components?.links, visitLink);
    register("callbacks", parsed.components?.callbacks, visitCallback);
    register("pathItems", parsed.components?.pathItems, visitPathItem);
    register("securitySchemes", parsed.components?.securitySchemes, visitSecurityScheme);

    const retainedPaths = yield* Effect.forEach(
      Record.toEntries(parsed.paths ?? {}),
      Effect.fnUntraced(function* ([path, value]) {
        if (pipe(path, String.startsWith("x-"))) return;
        const item = yield* Schema.decodeEffect(OpenApiPathItem)(value);
        if (item.$ref !== undefined || Array.some(methods, (method) => item[method] !== undefined))
          return item;
        removedPaths.add(path);
      }),
    );

    yield* Effect.forEach(
      retainedPaths,
      (item) => (item === undefined ? Effect.void : visitPathItem(item)),
      { discard: true },
    );

    yield* visitMap(parsed.webhooks, visitPathItem);
    yield* visitMap(parsed.$defs, (value) => visitSchema(value));
    yield* visitSecurity(parsed.security);

    yield* Effect.forEach(
      linkedOperationIds,
      (id) =>
        operationIds.has(id)
          ? Effect.void
          : new OverlayError({ message: `Missing linked operationId ${id}` }),
      { discard: true },
    );

    const paths = document.paths;
    if (Predicate.isObject(paths) && !Array.isArray(paths))
      Array.forEach(removedPaths, (path) => {
        delete paths[path];
      });

    const maps = document.components;
    if (Predicate.isObject(maps) && !Array.isArray(maps))
      Array.forEach(Record.toEntries(maps), ([category, entries]) => {
        if (
          pipe(category, String.startsWith("x-")) ||
          !Predicate.isObject(entries) ||
          Array.isArray(entries)
        )
          return;

        Array.forEach(Record.keys(entries), (name) => {
          if (!used.has(componentPointer(category, name))) delete entries[name];
        });

        if (Record.keys(entries).length === 0) delete maps[category];
      });

    return document;
  },
  Effect.mapError(
    (cause) => new OverlayError({ message: `Cannot prune components: ${cause.message}`, cause }),
  ),
);
