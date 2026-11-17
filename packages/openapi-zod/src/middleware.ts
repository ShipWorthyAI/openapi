import { Array, Formatter, pipe, String } from "effect";

/** A validator expression the middleware table calls lazily, as emitted source. */
export type ValidatorSource = string;

/** One operation's validators, keyed by `METHOD path` as the middleware looks them up. */
export interface MiddlewareOperationSource {
  readonly key: string;
  readonly request: ValidatorSource | undefined;
  /** Status code, range such as `2XX`, or `default` → media type → validator. */
  readonly responses: ReadonlyArray<
    readonly [string, ReadonlyArray<readonly [string, ValidatorSource]>]
  >;
}

/** Names the middleware section declares, which component exports must not reuse. */
export const middlewareNames = [
  "onRequestValidation",
  "onResponseValidation",
  "OpenApiValidationError",
  "__openapiValidation",
  "__openapiLazy",
  "__openapiJsonMediaType",
  "__openapiJsonBody",
  "__OpenApiOperationValidation",
  "__openapiWireComponents",
] as const;

/** Whether the middleware can validate a body documented under `mediaType` (lower-cased essence). */
export function isValidatedMediaType(mediaType: string): boolean {
  return (
    mediaType === "application/json" ||
    pipe(mediaType, String.endsWith("+json")) ||
    mediaType === "application/*" ||
    mediaType === "*/*"
  );
}

/** `application/json; charset=utf-8` → `application/json`. */
export function mediaTypeEssence(mediaType: string): string {
  return pipe(mediaType, String.split(";"), Array.headNonEmpty, String.trim, String.toLowerCase);
}

function indent(value: string, spaces: number): string {
  const pad = pipe(" ", String.repeat(spaces));

  return pipe(
    value,
    String.split("\n"),
    Array.map((line) => (line.length === 0 ? line : pad + line)),
    Array.join("\n"),
  );
}

function objectLiteral(entries: ReadonlyArray<readonly [string, string]>): string {
  if (entries.length === 0) return "{}";

  const body = pipe(
    entries,
    Array.map(([key, value]) => `${Formatter.formatJson(key)}: ${value},`),
    Array.join("\n"),
  );

  return `{\n${indent(body, 2)}\n}`;
}

function operationLiteral(operation: MiddlewareOperationSource): string {
  const responses = objectLiteral(
    Array.map(operation.responses, ([code, contents]) => [code, objectLiteral(contents)] as const),
  );

  return objectLiteral([
    ...(operation.request === undefined ? [] : [["request", operation.request] as const]),
    ["responses", responses],
  ]);
}

const runtime = `export class OpenApiValidationError extends Error {
  override readonly name = "OpenApiValidationError";
  /** Which side of the exchange failed validation. */
  readonly direction: "request" | "response";
  readonly method: string;
  /** The OpenAPI path template, such as \`/items/{id}\`. */
  readonly schemaPath: string;
  /** The response status, for response failures. */
  readonly status: number | undefined;
  readonly error: z.ZodError;

  constructor(options: {
    readonly direction: "request" | "response";
    readonly method: string;
    readonly schemaPath: string;
    readonly status: number | undefined;
    readonly error: z.ZodError;
  }) {
    const status = options.status === undefined ? "" : \` \${options.status}\`;
    super(
      \`Invalid \${options.direction} body for \${options.method} \${options.schemaPath}\${status}\\n\${z.prettifyError(options.error)}\`,
    );
    this.direction = options.direction;
    this.method = options.method;
    this.schemaPath = options.schemaPath;
    this.status = options.status;
    this.error = options.error;
  }

  get issues(): z.ZodError["issues"] {
    return this.error.issues;
  }
}

interface __OpenApiOperationValidation {
  readonly request?: () => z.ZodType;
  readonly responses: Partial<Record<string, Partial<Record<string, () => z.ZodType>>>>;
}

function __openapiLazy(factory: () => z.ZodType): () => z.ZodType {
  let schema: z.ZodType | undefined;
  return () => (schema ??= factory());
}

function __openapiJsonMediaType(headers: Headers): string | undefined {
  const mediaType = headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mediaType === undefined) return undefined;
  return mediaType === "application/json" || mediaType.endsWith("+json") ? mediaType : undefined;
}

async function __openapiJsonBody(message: Request | Response): Promise<{ readonly value: unknown } | undefined> {
  if (message.body === null) return undefined;
  const text = await message.clone().text();
  if (text === "") return undefined;

  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    // Leave malformed JSON to the client, which reports it when it parses the body.
    return undefined;
  }
}

/**
 * openapi-fetch \`onRequest\` middleware. Validates a JSON request body against the operation's
 * request body schema and throws \`OpenApiValidationError\` when it does not match.
 */
export async function onRequestValidation({
  request,
  schemaPath,
}: {
  readonly request: Request;
  readonly schemaPath: string;
}): Promise<undefined> {
  const method = request.method.toUpperCase();
  const validator = __openapiValidation[\`\${method} \${schemaPath}\`]?.request;
  if (validator === undefined || __openapiJsonMediaType(request.headers) === undefined) return undefined;
  const body = await __openapiJsonBody(request);
  if (body === undefined) return undefined;
  const result = validator().safeParse(body.value);

  if (!result.success)
    throw new OpenApiValidationError({
      direction: "request",
      method,
      schemaPath,
      status: undefined,
      error: result.error,
    });

  return undefined;
}

/**
 * openapi-fetch \`onResponse\` middleware. Validates a JSON response body against the schema
 * documented for its status code (exact code, then range such as \`2XX\`, then \`default\`) and
 * media type, and throws \`OpenApiValidationError\` when it does not match.
 */
export async function onResponseValidation({
  request,
  response,
  schemaPath,
}: {
  readonly request: Request;
  readonly response: Response;
  readonly schemaPath: string;
}): Promise<undefined> {
  const method = request.method.toUpperCase();
  const responses = __openapiValidation[\`\${method} \${schemaPath}\`]?.responses;
  if (responses === undefined) return undefined;
  const status = String(response.status);
  const contents = responses[status] ?? responses[\`\${status.charAt(0)}XX\`] ?? responses.default;
  const mediaType = __openapiJsonMediaType(response.headers);
  if (contents === undefined || mediaType === undefined) return undefined;

  const validator =
    contents[mediaType] ?? contents[\`\${mediaType.split("/")[0]}/*\`] ?? contents["*/*"];

  if (validator === undefined) return undefined;
  const body = await __openapiJsonBody(response);
  if (body === undefined) return undefined;
  const result = validator().safeParse(body.value);

  if (!result.success)
    throw new OpenApiValidationError({
      direction: "response",
      method,
      schemaPath,
      status: response.status,
      error: result.error,
    });

  return undefined;
}`;

/**
 * The validation middleware section: the error class, helpers, operation table, and hooks.
 * `wireComponents` maps component names to validators shared by several table entries.
 */
export function middlewareSource(
  operations: ReadonlyArray<MiddlewareOperationSource>,
  wireComponents: ReadonlyArray<readonly [string, ValidatorSource]>,
): string {
  const table = objectLiteral(
    Array.map(operations, (operation) => [operation.key, operationLiteral(operation)] as const),
  );

  // Declared before the table, which reads it while the module initializes.
  const shared =
    wireComponents.length === 0
      ? ""
      : `const __openapiWireComponents = ${objectLiteral(wireComponents)};\n\n`;

  return `${runtime}\n\n${shared}const __openapiValidation: Partial<Record<string, __OpenApiOperationValidation>> = ${table};`;
}
