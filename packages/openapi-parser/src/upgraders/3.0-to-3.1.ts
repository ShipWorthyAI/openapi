import { JsonSchema, Predicate } from "effect";
import { OpenApiHttpMethod } from "../schemas/3.1/http-method.ts";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return Predicate.isObject(value) ? value : undefined;
}

const METHODS: ReadonlySet<string> = new Set(OpenApiHttpMethod.literals);

const SINGLE_KEYS = [
  "not",
  "additionalProperties",
  "unevaluatedProperties",
  "items",
  "additionalItems",
  "contains",
  "if",
  "then",
  "else",
  "propertyNames",
  "unevaluatedItems",
  "contentSchema",
];

const ARRAY_KEYS = ["allOf", "anyOf", "oneOf", "prefixItems"];
const MAP_KEYS = ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"];

export interface Slot {
  parent: Record<string, unknown>;
  key: string;
}

export function isOpenApi3(document: unknown): document is Record<string, unknown> {
  const record = asRecord(document);
  return typeof record?.openapi === "string" && record.openapi.startsWith("3.");
}

export function isOpenApi3_0(document: unknown): boolean {
  const record = asRecord(document);
  return typeof record?.openapi === "string" && record.openapi.startsWith("3.0");
}

export function upgradeOpenApi3_0(document: Record<string, unknown>): void {
  if (!isOpenApi3_0(document)) return;

  for (const slot of schemaSlots(document)) {
    slot.parent[slot.key] = upgradeSchema(slot.parent[slot.key]);
  }

  document.openapi = "3.1.0";
}

export function schemaSlots(
  document: Record<string, unknown>,
  includeComponentSchemas = true,
): Slot[] {
  const slots: Slot[] = [];
  const components = asRecord(document.components);

  if (components) {
    if (includeComponentSchemas) collectSchemaMap(components.schemas, slots);
    collectParameterMap(components.parameters, slots);
    collectResponseMap(components.responses, slots);
    collectRequestBodyMap(components.requestBodies, slots);
    collectHeaderMap(components.headers, slots);
    const pathItems = asRecord(components.pathItems);

    if (pathItems) {
      for (const value of Object.values(pathItems)) collectPathItem(value, slots);
    }
  }

  const paths = asRecord(document.paths);

  if (paths) {
    for (const value of Object.values(paths)) collectPathItem(value, slots);
  }

  const webhooks = asRecord(document.webhooks);

  if (webhooks) {
    for (const value of Object.values(webhooks)) collectPathItem(value, slots);
  }

  return slots;
}

export function componentSchemas(document: Record<string, unknown>): Slot[] {
  const slots: Slot[] = [];
  collectSchemaMap(asRecord(document.components)?.schemas, slots);
  return slots;
}

function collectSchemaMap(value: unknown, slots: Slot[]) {
  const map = asRecord(value);
  if (!map) return;
  for (const key of Object.keys(map)) slots.push({ parent: map, key });
}

function collectParameterMap(value: unknown, slots: Slot[]) {
  const map = asRecord(value);
  if (!map) return;
  for (const parameter of Object.values(map)) collectParameter(parameter, slots);
}

function collectResponseMap(value: unknown, slots: Slot[]) {
  const map = asRecord(value);
  if (!map) return;
  for (const response of Object.values(map)) collectResponse(response, slots);
}

function collectRequestBodyMap(value: unknown, slots: Slot[]) {
  const map = asRecord(value);
  if (!map) return;
  for (const body of Object.values(map)) collectRequestBody(body, slots);
}

function collectHeaderMap(value: unknown, slots: Slot[]) {
  const map = asRecord(value);
  if (!map) return;
  for (const header of Object.values(map)) collectHeader(header, slots);
}

function collectPathItem(value: unknown, slots: Slot[]) {
  const record = asRecord(value);
  if (!record || typeof record.$ref === "string") return;
  collectParameterList(record.parameters, slots);

  for (const [key, child] of Object.entries(record)) {
    if (METHODS.has(key)) collectOperation(child, slots);
  }
}

function collectOperation(value: unknown, slots: Slot[]) {
  const record = asRecord(value);
  if (!record) return;
  collectParameterList(record.parameters, slots);
  collectRequestBody(record.requestBody, slots);
  const responses = asRecord(record.responses);

  if (responses) {
    for (const response of Object.values(responses)) collectResponse(response, slots);
  }

  const callbacks = asRecord(record.callbacks);

  if (callbacks) {
    for (const callback of Object.values(callbacks)) {
      const paths = asRecord(callback);
      if (!paths || typeof paths.$ref === "string") continue;
      for (const pathItem of Object.values(paths)) collectPathItem(pathItem, slots);
    }
  }
}

function collectParameterList(value: unknown, slots: Slot[]) {
  if (!Array.isArray(value)) return;
  for (const parameter of value) collectParameter(parameter, slots);
}

function collectParameter(value: unknown, slots: Slot[]) {
  const record = asRecord(value);
  if (!record || typeof record.$ref === "string") return;
  if ("schema" in record) slots.push({ parent: record, key: "schema" });
  collectContent(record.content, slots);
}

function collectRequestBody(value: unknown, slots: Slot[]) {
  const record = asRecord(value);
  if (!record || typeof record.$ref === "string") return;
  collectContent(record.content, slots);
}

function collectResponse(value: unknown, slots: Slot[]) {
  const record = asRecord(value);
  if (!record || typeof record.$ref === "string") return;
  collectContent(record.content, slots);
  collectHeaderMap(record.headers, slots);
}

function collectHeader(value: unknown, slots: Slot[]) {
  const record = asRecord(value);
  if (!record || typeof record.$ref === "string") return;
  if ("schema" in record) slots.push({ parent: record, key: "schema" });
  collectContent(record.content, slots);
}

function collectContent(value: unknown, slots: Slot[]) {
  const content = asRecord(value);
  if (!content) return;

  for (const media of Object.values(content)) {
    const mediaRecord = asRecord(media);
    if (mediaRecord && "schema" in mediaRecord) slots.push({ parent: mediaRecord, key: "schema" });
  }
}

function upgradeSchema(value: unknown): unknown {
  const record = asRecord(value);
  if (!record) return value;

  for (const key of SINGLE_KEYS) {
    if (!(key in record)) continue;

    if (key === "items" && Array.isArray(record.items)) {
      record.items = record.items.map((item) => upgradeSchema(item));
    } else {
      record[key] = upgradeSchema(record[key]);
    }
  }

  for (const key of ARRAY_KEYS) {
    if (Array.isArray(record[key]))
      record[key] = (record[key] as unknown[]).map((item) => upgradeSchema(item));
  }

  for (const key of MAP_KEYS) {
    const map = asRecord(record[key]);
    if (!map) continue;
    for (const child of Object.keys(map)) map[child] = upgradeSchema(map[child]);
  }

  if (Array.isArray(record.items)) {
    record.prefixItems = record.items;

    if ("additionalItems" in record) {
      record.items = record.additionalItems;
      delete record.additionalItems;
    } else {
      delete record.items;
    }
  }

  if (typeof record.$ref === "string" && Object.keys(record).some((key) => key !== "$ref")) {
    const nullable = record.nullable === true;
    const readOnly = record.readOnly === true;
    const writeOnly = record.writeOnly === true;
    const { $ref, ...siblings } = record;
    delete siblings.nullable;
    if (readOnly) delete siblings.readOnly;
    if (writeOnly) delete siblings.writeOnly;

    // OpenAPI 3.0 ignores the siblings of a $ref; 3.1 applies them, so they move into allOf
    const target: Record<string, unknown> =
      Object.keys(siblings).length > 0 ? { allOf: [{ $ref }, siblings] } : { $ref };

    const lifted = nullable ? orNull(target) : target;
    if (readOnly) lifted.readOnly = true;
    if (writeOnly) lifted.writeOnly = true;
    return lifted;
  }

  return applyOpenApi30Keywords(record);
}

/** Keywords that describe a schema without constraining it. They stay outside `orNull`'s `anyOf`. */
const ANNOTATION_KEYS = new Set([
  "title",
  "description",
  "default",
  "deprecated",
  "readOnly",
  "writeOnly",
  "example",
  "examples",
  "externalDocs",
  "xml",
  "$comment",
]);

/** `schema` or null, as `anyOf: [schema, { type: "null" }]`. Annotations and extensions stay outside. */
function orNull(schema: Record<string, unknown>): Record<string, unknown> {
  const outer: Record<string, unknown> = {};
  const inner: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (ANNOTATION_KEYS.has(key) || key.startsWith("x-")) outer[key] = value;
    else inner[key] = value;
  }

  return Object.keys(inner).length === 0 ? schema : { ...outer, anyOf: [inner, { type: "null" }] };
}

function applyOpenApi30Keywords(schema: Record<string, unknown>): Record<string, unknown> {
  const nullable = schema.nullable === true;
  delete schema.nullable;

  if (
    typeof schema.exclusiveMinimum === "boolean" ||
    typeof schema.exclusiveMaximum === "boolean"
  ) {
    const projection: JsonSchema.JsonSchema = {};
    if ("minimum" in schema) projection.minimum = schema.minimum;
    if ("maximum" in schema) projection.maximum = schema.maximum;
    if ("exclusiveMinimum" in schema) projection.exclusiveMinimum = schema.exclusiveMinimum;
    if ("exclusiveMaximum" in schema) projection.exclusiveMaximum = schema.exclusiveMaximum;
    const converted = JsonSchema.fromSchemaOpenApi3_0(projection).schema;
    delete schema.minimum;
    delete schema.maximum;
    delete schema.exclusiveMinimum;
    delete schema.exclusiveMaximum;

    for (const key of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"] as const) {
      if (key in converted) schema[key] = converted[key];
    }
  }

  if ("example" in schema) {
    const converted = JsonSchema.fromSchemaOpenApi3_0({ example: schema.example }).schema;
    const existing = Array.isArray(schema.examples) ? schema.examples : [];
    const convertedExamples = Array.isArray(converted.examples) ? converted.examples : [];
    schema.examples = [...convertedExamples, ...existing];
    delete schema.example;
  }

  if (!nullable) return schema;

  // A "null" type can only join a schema's own type. Compositions have to hold for null too,
  // so a schema with allOf/anyOf/oneOf, or without a type, becomes a disjunction instead.
  const composed = "allOf" in schema || "anyOf" in schema || "oneOf" in schema;

  if (typeof schema.type === "string" && !composed) {
    const converted = JsonSchema.fromSchemaOpenApi3_0({ type: schema.type, nullable: true }).schema;
    schema.type = converted.type;
    if (Array.isArray(schema.enum) && !schema.enum.includes(null))
      schema.enum = [...schema.enum, null];
    return schema;
  }

  return orNull(schema);
}
