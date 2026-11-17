import type { ParsedOperation, ParsedSchema, ParsedService } from "@shipworthy/openapi-transformer";
import { Array, Formatter, JsonPointer, Order, pipe, Record, Result, String } from "effect";

/** A request or response body schema the middleware validates, in document order. */
export interface MiddlewareRoot {
  /** Location used in error messages, such as `GET /items/responses/200/content/application/json`. */
  readonly path: string;
  readonly schema: ParsedSchema;
}

/** A body validator: a root to compile, or a component whose validator is reused. */
export type MiddlewareValidator = { readonly root: number } | { readonly component: string };

type MediaTypes = ReadonlyArray<readonly [mediaType: string, validator: MiddlewareValidator]>;

/** One operation's validators. */
export interface MiddlewareOperation {
  /** `METHOD path`, as the middleware looks it up. */
  readonly key: string;
  readonly request: MediaTypes;
  /** Status code, range such as `2XX`, or `default` → media types. */
  readonly responses: ReadonlyArray<readonly [code: string, contents: MediaTypes]>;
}

export interface MiddlewarePlan {
  /** Inline body schemas, compiled for the middleware alone. */
  readonly roots: readonly MiddlewareRoot[];
  readonly operations: readonly MiddlewareOperation[];
  /** Components that bodies only reference, sorted by name. */
  readonly components: readonly string[];
}

/** Names the middleware section declares, which component exports must not reuse. */
export const middlewareNames: ReadonlySet<string> = new Set([
  "onRequestValidation",
  "onResponseValidation",
  "OpenApiValidationError",
  "OpenApiValidationIssue",
  "__openapiValidation",
  "__openapiValidate",
  "__openapiJsonMediaType",
  "__openapiJsonBody",
  "__openapiFormatIssues",
  "__OpenApiStandardSchema",
  "__OpenApiOperationValidation",
  "__openapiWireComponents",
]);

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

/** The component `schema` only references, ignoring annotations, if any. */
function referencedComponent(model: ParsedService, schema: ParsedSchema): string | undefined {
  if (typeof schema === "boolean" || typeof schema.$ref !== "string") return undefined;
  const path = JsonPointer.parseUriFragment(schema.$ref);
  const name = path?.[2];

  if (
    path?.length !== 3 ||
    path[0] !== "components" ||
    path[1] !== "schemas" ||
    name === undefined ||
    !Record.has(model.components.schemas, name)
  )
    return undefined;

  return Array.every(
    Record.keys<string, unknown>(schema),
    (key) => key === "$ref" || annotations.has(key) || pipe(key, String.startsWith("x-")),
  )
    ? name
    : undefined;
}

/** Whether the middleware can validate a body documented under `mediaType` (lower-cased essence). */
function isValidatedMediaType(mediaType: string): boolean {
  return (
    mediaType === "application/json" ||
    pipe(mediaType, String.endsWith("+json")) ||
    mediaType === "application/*" ||
    mediaType === "*/*"
  );
}

/** `application/json; charset=utf-8` → `application/json`. */
function mediaTypeEssence(mediaType: string): string {
  return pipe(mediaType, String.split(";"), Array.headNonEmpty, String.trim, String.toLowerCase);
}

/** JSON media types with a schema, by essence, first documented wins. */
function jsonContents(
  contents: ReadonlyArray<{
    readonly mediaType: string;
    readonly schema?: ParsedSchema | undefined;
  }>,
  path: string,
) {
  return pipe(
    contents,
    Array.filterMap((content) => {
      const mediaType = mediaTypeEssence(content.mediaType);

      return content.schema === undefined || !isValidatedMediaType(mediaType)
        ? Result.failVoid
        : Result.succeed({
            mediaType,
            root: { path: `${path}/${content.mediaType}`, schema: content.schema },
          });
    }),
    Array.dedupeWith((a, b) => a.mediaType === b.mediaType),
  );
}

/** Every operation's JSON request and response body schemas, with `model`'s field names. */
export function middlewarePlan(model: ParsedService): MiddlewarePlan {
  const roots: MiddlewareRoot[] = [];

  const add = (entries: ReturnType<typeof jsonContents>): MediaTypes =>
    Array.map(entries, ({ mediaType, root }) => {
      const component = referencedComponent(model, root.schema);
      if (component !== undefined) return [mediaType, { component }] as const;
      roots.push(root);
      return [mediaType, { root: roots.length - 1 }] as const;
    });

  const operations = Array.map(model.operations, (operation: ParsedOperation) => {
    const location = `${operation.method} ${operation.path}`;

    return {
      key: location,
      request: add(
        jsonContents(operation.request.body?.contents ?? [], `${location}/requestBody/content`),
      ),
      responses: Array.map(
        operation.responses,
        (response) =>
          [
            response.code,
            add(jsonContents(response.contents, `${location}/responses/${response.code}/content`)),
          ] as const,
      ),
    };
  });

  const components = pipe(
    operations,
    Array.flatMap((operation) => [
      ...operation.request,
      ...Array.flatMap(operation.responses, ([, contents]) => contents),
    ]),
    Array.filterMap(([, validator]) =>
      "component" in validator ? Result.succeed(validator.component) : Result.failVoid,
    ),
    Array.dedupe,
    Array.sort(Order.String),
  );

  return { roots, operations, components };
}

/** A root per referenced component, for compiling the components with the wire field names. */
export function componentRoots(plan: MiddlewarePlan): readonly MiddlewareRoot[] {
  return Array.map(plan.components, (name) => {
    const ref = JsonPointer.formatUriFragment(["components", "schemas", name]);
    return { path: ref, schema: { $ref: ref } };
  });
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

const runtime = `/** One Standard Schema issue, as \`OpenApiValidationError\` reports it. */
export interface OpenApiValidationIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

interface __OpenApiStandardSchema {
  readonly "~standard": {
    readonly validate: (
      value: unknown,
    ) =>
      | { readonly issues?: ReadonlyArray<OpenApiValidationIssue> | undefined }
      | Promise<{ readonly issues?: ReadonlyArray<OpenApiValidationIssue> | undefined }>;
  };
}

interface __OpenApiOperationValidation {
  readonly request: Partial<Record<string, __OpenApiStandardSchema>>;
  readonly responses: Partial<Record<string, Partial<Record<string, __OpenApiStandardSchema>>>>;
}

function __openapiFormatIssues(issues: ReadonlyArray<OpenApiValidationIssue>): string {
  return issues
    .map((issue) => {
      const path = (issue.path ?? [])
        .map((segment) => String(typeof segment === "object" ? segment.key : segment))
        .join(".");

      return path === "" ? \`  - \${issue.message}\` : \`  - \${path}: \${issue.message}\`;
    })
    .join("\\n");
}

export class OpenApiValidationError extends Error {
  override readonly name = "OpenApiValidationError";
  /** Which side of the exchange failed validation. */
  readonly direction: "request" | "response";
  readonly method: string;
  /** The OpenAPI path template, such as \`/items/{id}\`. */
  readonly schemaPath: string;
  /** The response status, for response failures. */
  readonly status: number | undefined;
  readonly issues: ReadonlyArray<OpenApiValidationIssue>;

  constructor(options: {
    readonly direction: "request" | "response";
    readonly method: string;
    readonly schemaPath: string;
    readonly status: number | undefined;
    readonly issues: ReadonlyArray<OpenApiValidationIssue>;
  }) {
    const status = options.status === undefined ? "" : \` \${options.status}\`;
    super(
      \`Invalid \${options.direction} body for \${options.method} \${options.schemaPath}\${status}\\n\${__openapiFormatIssues(options.issues)}\`,
    );
    this.direction = options.direction;
    this.method = options.method;
    this.schemaPath = options.schemaPath;
    this.status = options.status;
    this.issues = options.issues;
  }
}

function __openapiJsonMediaType(headers: Headers): string | undefined {
  const mediaType = headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mediaType === undefined) return undefined;
  return mediaType === "application/json" || mediaType.endsWith("+json") ? mediaType : undefined;
}

async function __openapiJsonBody(
  message: Request | Response,
): Promise<{ readonly value: unknown } | undefined> {
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

/** Validates a JSON body with the schema documented for its media type, if any. */
async function __openapiValidate(
  message: Request | Response,
  contents: Partial<Record<string, __OpenApiStandardSchema>> | undefined,
): Promise<ReadonlyArray<OpenApiValidationIssue> | undefined> {
  const mediaType = __openapiJsonMediaType(message.headers);
  if (contents === undefined || mediaType === undefined) return undefined;

  const schema =
    contents[mediaType] ?? contents[\`\${mediaType.split("/")[0]}/*\`] ?? contents["*/*"];

  if (schema === undefined) return undefined;
  const body = await __openapiJsonBody(message);
  if (body === undefined) return undefined;
  const result = await schema["~standard"].validate(body.value);
  return result.issues;
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
  const contents = __openapiValidation[\`\${method} \${schemaPath}\`]?.request;
  const issues = await __openapiValidate(request, contents);

  if (issues !== undefined)
    throw new OpenApiValidationError({
      direction: "request",
      method,
      schemaPath,
      status: undefined,
      issues,
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
  const issues = await __openapiValidate(response, contents);

  if (issues !== undefined)
    throw new OpenApiValidationError({
      direction: "response",
      method,
      schemaPath,
      status: response.status,
      issues,
    });

  return undefined;
}`;

/**
 * The validation middleware section. `validator(root)` is the emitted Standard Schema expression
 * for the root at that index of `plan.roots`. `component(name)` is the expression for a
 * component's validator, and `shared` declares validators that several entries use.
 */
export function middlewareSource(
  plan: MiddlewarePlan,
  validator: (root: number) => string,
  component: (name: string) => string,
  shared: ReadonlyArray<readonly [string, string]> = [],
): string {
  const media = (contents: MediaTypes) =>
    objectLiteral(
      Array.map(
        contents,
        ([mediaType, entry]) =>
          [
            mediaType,
            "root" in entry ? validator(entry.root) : component(entry.component),
          ] as const,
      ),
    );

  const table = objectLiteral(
    Array.map(
      plan.operations,
      (operation) =>
        [
          operation.key,
          objectLiteral([
            ["request", media(operation.request)],
            [
              "responses",
              objectLiteral(
                Array.map(
                  operation.responses,
                  ([code, contents]) => [code, media(contents)] as const,
                ),
              ),
            ],
          ]),
        ] as const,
    ),
  );

  // Declared before the table, which reads it while the module initializes.
  const components =
    shared.length === 0 ? "" : `const __openapiWireComponents = ${objectLiteral(shared)};\n\n`;

  return `${runtime}\n\n${components}const __openapiValidation: Partial<Record<string, __OpenApiOperationValidation>> = ${table};`;
}
