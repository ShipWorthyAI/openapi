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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The same version gate `invalid.test.ts` asserts. */
export function versionMessage(document: unknown): string | undefined {
  if (!isRecord(document)) return "Unsupported schema format, expected `openapi: 3.x`";
  const openapi = typeof document.openapi === "string" ? document.openapi : undefined;
  const openapiVersion = Number.parseFloat(openapi ?? "");

  if (
    document.swagger ||
    !openapi ||
    Number.isNaN(openapiVersion) ||
    openapiVersion < 3 ||
    openapiVersion >= 4
  ) {
    if (document.swagger) return "Unsupported Swagger version: 2.x. Use OpenAPI 3.x instead.";

    if (openapi || openapiVersion < 3 || openapiVersion >= 4) {
      return `Unsupported OpenAPI version: ${openapi}`;
    }

    return "Unsupported schema format, expected `openapi: 3.x`";
  }

  return undefined;
}

export function decodePointer(token: string): string {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}
