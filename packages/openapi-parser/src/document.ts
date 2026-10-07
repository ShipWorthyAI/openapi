import { Predicate, Result, Schema } from "effect";
import { UnsupportedVersion } from "./errors.js";

export interface OpenAPIDocument {
  openapi: string;
  info?: { title?: string; version?: string; [key: string]: unknown };
  jsonSchemaDialect?: string;
  servers?: unknown[];
  paths?: Record<string, unknown>;
  webhooks?: Record<string, unknown>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
    [key: string]: unknown;
  };
  security?: unknown[];
  tags?: unknown[];
  externalDocs?: unknown;
  $defs?: Record<string, unknown>;
  [key: string]: unknown;
}

const unsupportedFormat = "Unsupported schema format, expected `openapi: 3.x`";

const openApi3 = Schema.Unknown.check(
  Schema.makeFilter((document: unknown): string | undefined => {
    if (!Predicate.isObject(document)) return unsupportedFormat;
    if (document.swagger) return "Unsupported Swagger version: 2.x. Use OpenAPI 3.x instead.";

    const openapi = document.openapi;
    if (typeof openapi !== "string" || openapi.length === 0) return unsupportedFormat;

    const version = Number.parseFloat(openapi);

    if (Number.isNaN(version) || version < 3 || version >= 4) {
      return `Unsupported OpenAPI version: ${openapi}`;
    }

    return undefined;
  }),
);

/** Rejects anything other than an OpenAPI 3.x document. Callers keep the original value. */
export function unsupportedVersion(document: unknown): UnsupportedVersion | undefined {
  const result = Schema.decodeUnknownResult(openApi3)(document);
  if (Result.isSuccess(result)) return undefined;
  return new UnsupportedVersion({ message: result.failure.message });
}
