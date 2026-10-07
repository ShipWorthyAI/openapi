import { decodePointer, isRecord, versionMessage, type OpenAPIDocument } from "./document.js";
import { UnsupportedVersion } from "./errors.js";

const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

export type HttpMethodName = Uppercase<(typeof methods)[number]>;

export interface ParsedParameter {
  readonly name: string;
  readonly required: boolean;
  readonly schema: unknown;
  readonly description?: string;
  readonly raw: Record<string, unknown>;
}

export interface ParsedMediaType {
  readonly schema?: unknown;
  readonly raw: unknown;
}

export interface ParsedRequestBody {
  readonly required: boolean;
  readonly content: Readonly<Record<string, ParsedMediaType>>;
  readonly raw: Record<string, unknown>;
}

export interface ParsedResponse {
  readonly status: string;
  readonly description?: string;
  readonly content: Readonly<Record<string, ParsedMediaType>>;
  readonly raw: Record<string, unknown>;
}

export interface ParsedOperation {
  readonly id: string | undefined;
  readonly operationId: string | undefined;
  readonly method: HttpMethodName;
  readonly path: string;
  readonly parameters: {
    readonly path: readonly ParsedParameter[];
    readonly query: readonly ParsedParameter[];
    readonly header: readonly ParsedParameter[];
    readonly cookie: readonly ParsedParameter[];
  };
  readonly requestBody?: ParsedRequestBody;
  readonly responses: readonly ParsedResponse[];
  readonly raw: Record<string, unknown>;
}

export interface ParsedOpenApi {
  readonly openapi: string;
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly [key: string]: unknown;
  };
  readonly tags: readonly unknown[];
  readonly security: readonly unknown[];
  readonly securitySchemes: Readonly<Record<string, unknown>>;
  readonly operations: readonly ParsedOperation[];
  readonly components: { readonly schemas: Readonly<Record<string, unknown>> };
  readonly webhooks: Readonly<Record<string, unknown>>;
  readonly $defs: Readonly<Record<string, unknown>>;
  readonly document: OpenAPIDocument;
}

export interface Generator<A> {
  readonly id: string;
  generate(model: ParsedOpenApi, options: Readonly<Record<string, unknown>>): A;
}

export function parseModel(document: unknown): ParsedOpenApi {
  const problem = versionMessage(document);
  if (problem) throw new UnsupportedVersion({ text: problem });
  const doc = document as OpenAPIDocument;
  const components = isRecord(doc.components) ? doc.components : {};
  const info = isRecord(doc.info) ? doc.info : {};

  return {
    openapi: doc.openapi,
    info: {
      ...info,
      title: typeof info.title === "string" ? info.title : "",
      version: typeof info.version === "string" ? info.version : "",
    },
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    security: Array.isArray(doc.security) ? doc.security : [],
    securitySchemes: isRecord(components.securitySchemes) ? components.securitySchemes : {},
    operations: operationsOf(doc),
    components: { schemas: isRecord(components.schemas) ? components.schemas : {} },
    webhooks: isRecord(doc.webhooks) ? doc.webhooks : {},
    $defs: isRecord(doc.$defs) ? doc.$defs : {},
    document: doc,
  };
}

function operationsOf(document: OpenAPIDocument): ParsedOperation[] {
  const paths = isRecord(document.paths) ? document.paths : {};
  const operations: ParsedOperation[] = [];

  for (const [path, item] of Object.entries(paths)) {
    if (path.startsWith("x-")) continue;
    const pathItem = resolveLocal(document, item);
    if (!isRecord(pathItem)) continue;

    for (const method of methods) {
      const raw = pathItem[method];
      if (raw === undefined) continue;
      const operation = resolveLocal(document, raw);
      if (!isRecord(operation)) continue;
      const operationId =
        typeof operation.operationId === "string" ? operation.operationId : undefined;

      operations.push({
        id: operationId,
        operationId,
        method: method.toUpperCase() as HttpMethodName,
        path,
        parameters: groupParameters(document, pathItem.parameters, operation.parameters),
        requestBody: requestBody(document, operation.requestBody),
        responses: responses(document, operation.responses),
        raw: operation,
      });
    }
  }

  return operations;
}

function groupParameters(document: OpenAPIDocument, pathLevel: unknown, operationLevel: unknown) {
  const grouped: Record<"path" | "query" | "header" | "cookie", ParsedParameter[]> = {
    path: [],
    query: [],
    header: [],
    cookie: [],
  };

  for (const source of [pathLevel, operationLevel]) {
    if (!Array.isArray(source)) continue;

    for (const entry of source) {
      const parameter = resolveLocal(document, entry);
      if (!isRecord(parameter) || typeof parameter.name !== "string") continue;
      const location = parameter.in;

      if (
        location !== "path" &&
        location !== "query" &&
        location !== "header" &&
        location !== "cookie"
      ) {
        continue;
      }

      const parsed: ParsedParameter = {
        name: parameter.name,
        required: parameter.required === true || location === "path",
        schema: parameter.schema,
        ...(typeof parameter.description === "string"
          ? { description: parameter.description }
          : {}),
        raw: parameter,
      };

      const list = grouped[location];
      const index = list.findIndex((item) => item.name === parsed.name);
      if (index >= 0) list[index] = parsed;
      else list.push(parsed);
    }
  }

  return grouped;
}

function requestBody(document: OpenAPIDocument, value: unknown): ParsedRequestBody | undefined {
  if (value === undefined) return undefined;
  const body = resolveLocal(document, value);
  if (!isRecord(body)) return undefined;
  return {
    required: body.required === true,
    content: mediaTypes(document, body.content),
    raw: body,
  };
}

function responses(document: OpenAPIDocument, value: unknown): ParsedResponse[] {
  if (!isRecord(value)) return [];
  const parsed: ParsedResponse[] = [];

  for (const [status, entry] of Object.entries(value)) {
    if (status.startsWith("x-")) continue;
    const response = resolveLocal(document, entry);
    if (!isRecord(response)) continue;

    parsed.push({
      status,
      ...(typeof response.description === "string" ? { description: response.description } : {}),
      content: mediaTypes(document, response.content),
      raw: response,
    });
  }

  return parsed;
}

function mediaTypes(document: OpenAPIDocument, value: unknown): Record<string, ParsedMediaType> {
  if (!isRecord(value)) return {};
  const content: Record<string, ParsedMediaType> = {};

  for (const [type, entry] of Object.entries(value)) {
    const media = resolveLocal(document, entry);
    content[type] = {
      ...(isRecord(media) && "schema" in media ? { schema: media.schema } : {}),
      raw: media,
    };
  }

  return content;
}

function resolveLocal(
  document: OpenAPIDocument,
  value: unknown,
  seen = new Set<unknown>(),
): unknown {
  if (!isRecord(value) || typeof value.$ref !== "string" || !value.$ref.startsWith("#/"))
    return value;
  if (seen.has(value)) return value;
  seen.add(value);
  let node: unknown = document;

  for (const token of value.$ref.slice(2).split("/")) {
    const key = decodePointer(token);

    if (Array.isArray(node)) {
      node = node[Number(key)];
      continue;
    }

    if (!isRecord(node)) return value;
    node = node[key];
  }

  return resolveLocal(document, node, seen);
}
