import type { ParsedService } from "@shipworthy/openapi-transformer";
import { Effect, Predicate, Schema } from "effect";
import * as z from "zod";
import { ZodGenerationError } from "./errors";
import { assertExportName } from "./names";
import { resolveDocumentRef } from "./refs";
import type { OperationRoute } from "./routes";

type JsonSchema = z.core.JSONSchema.JSONSchema;
type SchemaNode = JsonSchema | boolean;

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

export interface ZodSources {
  /** Shared JSON Schema values imported by the other files. */
  definitions: string;
  /** One compiled Zod schema per component schema. */
  schemas: string;
  /** One compiled Zod schema per JSON request body, named `<operationId>RequestBody`. */
  operations: string;
}

interface SchemaExport {
  name: string;
  schema: SchemaNode;
  expression?: string;
}

function reject(message: string): never {
  throw new ZodGenerationError({ message });
}

function isAnnotation(key: string): boolean {
  return annotations.has(key) || key.startsWith("x-");
}

function asSchema(value: unknown, path: string): SchemaNode {
  if (typeof value === "boolean") return value;
  if (Predicate.isObject(value)) return value as JsonSchema;
  reject(`${path}: Expected a JSON schema`);
}

function definitionSchema(schema: SchemaNode): JsonSchema {
  if (schema === true) return {};
  if (schema === false) return { not: {} };
  return schema;
}

function isSingleRequiredKey(part: SchemaNode): part is JsonSchema & { required: string[] } {
  return (
    Predicate.isObject(part) &&
    Object.keys(part).length === 1 &&
    Array.isArray(part.required) &&
    part.required.length === 1 &&
    Predicate.isString(part.required[0])
  );
}

function indent(value: string, spaces: number): string {
  const pad = " ".repeat(spaces);

  return value
    .split("\n")
    .map((line) => (line.length === 0 ? line : pad + line))
    .join("\n");
}

function schemaLiteral(schema: SchemaNode, names: readonly string[], expression?: string): string {
  if (names.length === 0) return expression ?? JSON.stringify(schema, null, 2);

  const defs = indent(
    names.map((name) => `${JSON.stringify(name)}: definitions.${name}`).join(",\n"),
    4,
  );

  if (expression) return `{\n  ...${expression},\n  $defs: {\n${defs}\n  },\n}`;
  const json = JSON.stringify(schema, null, 2);
  if (!json.startsWith("{\n")) return `{\n  $defs: {\n${defs}\n  },\n}`;
  return `{\n${json.slice(2, -2)},\n  $defs: {\n${defs}\n  },\n}`;
}

function definitionName(ref: string): string {
  const marker = "#/$defs/";
  if (!ref.startsWith(marker)) reject(`${ref}: Reference not found`);
  return ref.slice(marker.length).replaceAll("~1", "/").replaceAll("~0", "~");
}

function objectProperties(
  document: ParsedService,
  schema: SchemaNode,
  path: string,
  seen: ReadonlySet<string>,
): Record<string, SchemaNode> {
  if (typeof schema === "boolean") return {};

  if (schema.$ref) {
    if (seen.has(schema.$ref)) return {};
    const resolved = asSchema(resolveDocumentRef(document, schema.$ref), schema.$ref);
    return objectProperties(document, resolved, path, new Set([...seen, schema.$ref]));
  }

  const merged: Record<string, SchemaNode> = {};

  for (const [index, part] of (schema.allOf ?? []).entries()) {
    const child = asSchema(part, `${path}/allOf/${index}`);
    Object.assign(merged, objectProperties(document, child, `${path}/allOf/${index}`, seen));
  }

  if (schema.properties) Object.assign(merged, schema.properties);
  return merged;
}

function normalize(
  document: ParsedService,
  schema: SchemaNode,
  path: string,
  inherited: Record<string, SchemaNode> = {},
): JsonSchema {
  // `true` and `false` are the same as `{}` and `{ not: {} }` once Zod converts them.
  if (typeof schema === "boolean") return definitionSchema(schema);

  for (const key of Object.keys(schema)) {
    if (!keywords.has(key) && !isAnnotation(key)) reject(`${path}: Unsupported keyword ${key}`);
  }

  const result: JsonSchema = { ...schema };
  delete result.default;

  const properties = {
    ...inherited,
    ...objectProperties(document, schema, path, new Set()),
  };

  if (schema.$ref) {
    if (!schema.$ref.startsWith("#/components/schemas/")) {
      reject(`${path}: Unsupported schema reference ${schema.$ref}`);
    }

    resolveDocumentRef(document, schema.$ref);

    for (const key of Object.keys(schema)) {
      if (key !== "$ref" && !isAnnotation(key)) {
        reject(`${path}: Zod does not preserve ${key} alongside $ref`);
      }
    }

    result.$ref = `#/$defs/${schema.$ref.slice("#/components/schemas/".length)}`;
    return result;
  }

  // In an object intersection, not(anyOf(required(single key))) forbids those keys.
  // Zod only accepts `not: {}` (never), so the forbidden keys become `false` schemas.
  if (schema.not !== undefined) {
    const notSchema = schema.not;
    const exclusions = Predicate.isObject(notSchema) ? notSchema.anyOf : undefined;
    const onlyNot = Object.keys(schema).every((key) => key === "not" || isAnnotation(key));

    if (
      !Array.isArray(exclusions) ||
      !Predicate.isObject(notSchema) ||
      Object.keys(notSchema).length !== 1 ||
      Object.keys(properties).length === 0 ||
      !onlyNot
    ) {
      reject(`${path}: Unsupported not constraint`);
    }

    const forbidden: Record<string, SchemaNode> = {};

    for (const part of exclusions) {
      const key = asSchema(part, path);
      if (!isSingleRequiredKey(key)) reject(`${path}: Unsupported not constraint`);
      const name = key.required[0];
      if (!name) reject(`${path}: Unsupported not constraint`);
      forbidden[name] = false;
    }

    delete result.not;
    result.type = "object";
    result.properties = forbidden;
    return result;
  }

  // Zod ignores required-only allOf branches. Copy the property schemas they inherit.
  if (schema.required && !schema.type) {
    if (!Array.isArray(schema.required)) reject(`${path}: Unsupported required constraint`);
    result.type = "object";
    const props: Record<string, SchemaNode> = { ...schema.properties };

    for (const name of schema.required) {
      const property = properties[name];
      if (property === undefined) reject(`${path}: Cannot resolve required property ${name}`);
      props[name] = property;
    }

    result.properties = props;
  }

  if (
    !result.type &&
    Object.keys(schema).some((key) => keywords.has(key) && !untypedKeywords.has(key))
  ) {
    reject(`${path}: Constraints without a type are not supported by Zod`);
  }

  for (const key of schemaMaps) {
    const values = result[key];
    if (!values) continue;
    if (!Predicate.isObject(values)) reject(`${path}: Unsupported ${key}`);
    const normalized: Record<string, SchemaNode> = {};

    for (const [name, value] of Object.entries(values)) {
      normalized[name] = normalize(
        document,
        asSchema(value, `${path}/${key}/${name}`),
        `${path}/${key}/${name}`,
      );
    }

    result[key] = normalized;
  }

  for (const key of compositions) {
    const values = result[key];
    if (!values) continue;
    if (!Array.isArray(values)) reject(`${path}: Unsupported ${key}`);
    const normalized: JsonSchema[] = [];

    for (const [index, part] of values.entries()) {
      normalized.push(
        normalize(
          document,
          asSchema(part, `${path}/${key}/${index}`),
          `${path}/${key}/${index}`,
          properties,
        ),
      );
    }

    result[key] = normalized;
  }

  if (result.prefixItems) {
    if (!Array.isArray(result.prefixItems)) reject(`${path}: Unsupported prefixItems`);
    const normalized: JsonSchema[] = [];

    for (const [index, part] of result.prefixItems.entries()) {
      normalized.push(
        normalize(
          document,
          asSchema(part, `${path}/prefixItems/${index}`),
          `${path}/prefixItems/${index}`,
        ),
      );
    }

    result.prefixItems = normalized;
  }

  for (const key of schemaFields) {
    const value = result[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) reject(`${path}: Tuple items require prefixItems`);

    result[key] = normalize(document, asSchema(value, `${path}/${key}`), `${path}/${key}`);
  }

  return result;
}

function visit(
  schema: SchemaNode,
  needed: Set<string>,
  definitions: ReadonlyMap<string, JsonSchema>,
) {
  if (typeof schema === "boolean") return;

  if (schema.$ref) {
    const name = definitionName(schema.$ref);

    if (!needed.has(name)) {
      const definition = definitions.get(name);
      if (definition === undefined) reject(`${schema.$ref}: Reference not found`);
      needed.add(name);
      visit(definition, needed, definitions);
    }
  }

  for (const key of schemaMaps) {
    const values = schema[key];
    if (!Predicate.isObject(values)) continue;

    for (const part of Object.values(values)) visit(asSchema(part, "schema"), needed, definitions);
  }

  for (const key of [...compositions, "prefixItems"] as const) {
    const values = schema[key];
    if (!Array.isArray(values)) continue;

    for (const part of values) visit(asSchema(part, "schema"), needed, definitions);
  }

  for (const key of schemaFields) {
    const value = schema[key];

    if (value !== undefined && !Array.isArray(value)) {
      visit(asSchema(value, "schema"), needed, definitions);
    }
  }
}

function compileExport(name: string, root: SchemaNode) {
  try {
    z.compile(z.fromJSONSchema(root));
  } catch (cause) {
    throw new ZodGenerationError({
      message: `${name}: ${cause instanceof Error ? cause.message : String(cause)}`,
      cause,
    });
  }
}

function source(
  entries: readonly SchemaExport[],
  definitions: ReadonlyMap<string, JsonSchema>,
): string {
  for (const { name } of entries) assertExportName(name, ["z", "definitions"]);

  let usesDefinitions = false;
  const exports: string[] = [];

  for (const { name, schema, expression } of entries) {
    const needed = new Set<string>();
    visit(schema, needed, definitions);
    const names = [...needed].sort();
    if (expression || names.length > 0) usesDefinitions = true;
    const defs: Record<string, JsonSchema> = {};

    for (const definition of names) {
      const value = definitions.get(definition);
      if (!value) reject(`#/$defs/${definition}: Reference not found`);
      defs[definition] = value;
    }

    const root =
      typeof schema === "boolean"
        ? schema
        : { ...schema, ...(names.length > 0 ? { $defs: defs } : {}) };

    compileExport(name, root);

    const argument = schemaLiteral(schema, names, expression);
    exports.push(`export const ${name} = z.compile(z.fromJSONSchema(${argument}));`);
  }

  if (exports.length === 0) return "";
  const imports = [`import * as z from "zod";`];
  if (usesDefinitions) imports.push(`import * as definitions from "./definitions";`);
  return `${imports.join("\n")}\n\n${exports.join("\n\n")}\n`;
}

function compile(model: ParsedService, routes: Record<string, OperationRoute>): ZodSources {
  if (!model.openapi.startsWith("3.1.")) reject("Zod generation requires OpenAPI 3.1");

  if (model.jsonSchemaDialect || Object.keys(model.$defs).length > 0) {
    reject("Zod generation does not support custom dialects or top-level $defs");
  }

  const definitions = new Map<string, JsonSchema>();

  for (const [name, schema] of Object.entries(model.components.schemas)) {
    const path = `#/components/schemas/${name}`;
    definitions.set(name, normalize(model, asSchema(schema, path), path));
  }

  const schemas = source(
    [...definitions].map(([name, schema]) => ({
      name,
      schema,
      expression: `definitions.${name}`,
    })),
    definitions,
  );

  const bodies: SchemaExport[] = [];

  for (const operation of model.operations) {
    const id = operation.operationId;
    if (!id || !Object.hasOwn(routes, id)) continue;
    const location = `${operation.method} ${operation.path}`;
    const body = operation.request.body;
    if (!body) continue;
    const content = body.contents.find((entry) => entry.mediaType === "application/json");

    if (body.contents.length !== 1 || !content) {
      reject(`${location}: Request bodies require a single application/json media type`);
    }

    if (content.schema === undefined) {
      reject(`${location}: Request body has no schema`);
    }

    const media = content.schema;

    bodies.push({
      name: `${id}RequestBody`,
      schema: normalize(model, asSchema(media, location), location),
    });
  }

  const definitionExports = [...definitions].map(
    ([name, schema]) =>
      `export const ${name}: z.core.JSONSchema.JSONSchema = ${JSON.stringify(schema, null, 2)};`,
  );

  return {
    definitions:
      definitionExports.length === 0
        ? ""
        : `import type * as z from "zod";\n\n${definitionExports.join("\n\n")}\n`,
    schemas,
    operations: source(bodies, definitions),
  };
}

function failure(cause: unknown): ZodGenerationError {
  if (Schema.is(ZodGenerationError)(cause)) return cause;

  return new ZodGenerationError({
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

/**
 * Turn an OpenAPI 3.1 document into Zod source.
 *
 * Component schemas become named exports. JSON request bodies become
 * `<operationId>RequestBody` exports. Shared schemas stay as JSON Schema in
 * `definitions`, and each validator includes only the `$defs` it references.
 * Defaults are removed so parsing does not fill them in.
 *
 * `routes` selects which operations can produce a request-body validator.
 * `operationRoutes` builds that table from the document.
 */
export const zodSources = Effect.fn("zodSources")(function* (
  document: ParsedService,
  routes: Record<string, OperationRoute>,
): Effect.fn.Return<ZodSources, ZodGenerationError> {
  return yield* Effect.try({
    try: () => compile(document, routes),
    catch: failure,
  });
});
