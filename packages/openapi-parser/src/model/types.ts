import type { JsonSchema } from "effect";

/** An OpenAPI schema node. OpenAPI 3.1 also allows a boolean schema. */
export type ParsedSchema = JsonSchema.JsonSchema | boolean;

const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

export type HttpMethodName = Uppercase<(typeof methods)[number]>;

export const httpMethods = methods;

export const parameterLocations = ["path", "query", "header", "cookie"] as const;

export type ParameterLocation = (typeof parameterLocations)[number];

export type ParsedExtensions = Readonly<Record<string, unknown>>;

export interface ParsedRef {
  readonly $ref: string;
  readonly summary?: string;
  readonly description?: string;
}

export interface ParsedExternalDocs {
  readonly url: string;
  readonly description?: string;
  readonly extensions: ParsedExtensions;
}

export interface ParsedContact {
  readonly name?: string;
  readonly url?: string;
  readonly email?: string;
  readonly extensions: ParsedExtensions;
}

export interface ParsedLicense {
  readonly name: string;
  readonly url?: string;
  readonly identifier?: string;
  readonly extensions: ParsedExtensions;
}

export interface ParsedInfo {
  readonly title: string;
  readonly version: string;
  readonly summary?: string;
  readonly description?: string;
  readonly termsOfService?: string;
  readonly contact?: ParsedContact;
  readonly license?: ParsedLicense;
  readonly extensions: ParsedExtensions;
}

export interface ParsedTag {
  readonly name: string;
  readonly description?: string;
  readonly externalDocs?: ParsedExternalDocs;
  readonly extensions: ParsedExtensions;
}

export interface ParsedServerVariable {
  readonly default: string;
  readonly enum?: readonly string[];
  readonly description?: string;
  readonly extensions: ParsedExtensions;
}

export interface ParsedServer {
  readonly url: string;
  readonly description?: string;
  readonly variables?: Readonly<Record<string, ParsedServerVariable>>;
  readonly extensions: ParsedExtensions;
}

export type ParsedSecurityRequirement = Readonly<Record<string, readonly string[]>>;

export type SecurityDeclaration = "none" | "declared" | "inherited";

export interface ParsedOAuthFlow {
  readonly authorizationUrl?: string;
  readonly tokenUrl?: string;
  readonly refreshUrl?: string;
  readonly scopes: Readonly<Record<string, string>>;
  readonly extensions: ParsedExtensions;
}

export interface ParsedOAuthFlows {
  readonly implicit?: ParsedOAuthFlow;
  readonly password?: ParsedOAuthFlow;
  readonly clientCredentials?: ParsedOAuthFlow;
  readonly authorizationCode?: ParsedOAuthFlow;
  readonly extensions: ParsedExtensions;
}

export type ParsedSecurityScheme =
  | {
      readonly type: "apiKey";
      readonly name: string;
      readonly in: "query" | "header" | "cookie";
      readonly description?: string;
      readonly extensions: ParsedExtensions;
    }
  | {
      readonly type: "http";
      readonly scheme: string;
      readonly bearerFormat?: string;
      readonly description?: string;
      readonly extensions: ParsedExtensions;
    }
  | {
      readonly type: "oauth2";
      readonly flows: ParsedOAuthFlows;
      readonly description?: string;
      readonly extensions: ParsedExtensions;
    }
  | {
      readonly type: "openIdConnect";
      readonly openIdConnectUrl: string;
      readonly description?: string;
      readonly extensions: ParsedExtensions;
    }
  | {
      readonly type: "mutualTLS";
      readonly description?: string;
      readonly extensions: ParsedExtensions;
    };

export interface ParsedExample {
  readonly name?: string;
  readonly summary?: string;
  readonly description?: string;
  readonly value?: unknown;
  readonly externalValue?: string;
  readonly $ref?: string;
  readonly extensions: ParsedExtensions;
}

export interface ParsedEncoding {
  readonly property: string;
  readonly contentType?: string;
  readonly style?: string;
  readonly explode?: boolean;
  readonly allowReserved?: boolean;
  readonly headers: Readonly<Record<string, ParsedHeaderValue>>;
  readonly extensions: ParsedExtensions;
}

export interface ParsedMediaType {
  readonly mediaType: string;
  readonly schema?: ParsedSchema;
  readonly example?: unknown;
  readonly examples: readonly ParsedExample[];
  readonly encodings: readonly ParsedEncoding[];
  readonly extensions: ParsedExtensions;
  readonly $ref?: string;
}

export interface ParsedHeader {
  readonly required: boolean;
  readonly deprecated: boolean;
  readonly description?: string;
  readonly style?: string;
  readonly explode?: boolean;
  readonly schema?: ParsedSchema;
  readonly contents: readonly ParsedMediaType[];
  readonly example?: unknown;
  readonly examples: readonly ParsedExample[];
  readonly extensions: ParsedExtensions;
}

export type ParsedHeaderValue = ParsedHeader | ParsedRef;

export interface ParsedParameter {
  readonly name: string;
  readonly in: ParameterLocation;
  readonly required: boolean;
  readonly deprecated: boolean;
  readonly description?: string;
  readonly style?: string;
  readonly explode?: boolean;
  readonly allowEmptyValue?: boolean;
  readonly allowReserved?: boolean;
  readonly schema?: ParsedSchema;
  readonly contents: readonly ParsedMediaType[];
  readonly example?: unknown;
  readonly examples: readonly ParsedExample[];
  readonly extensions: ParsedExtensions;
}

export type ParsedParameterValue = ParsedParameter | ParsedRef;

export interface ParsedRequestBody {
  readonly description?: string;
  readonly required: boolean;
  readonly contents: readonly ParsedMediaType[];
  readonly extensions: ParsedExtensions;
}

export type ParsedRequestBodyValue = ParsedRequestBody | ParsedRef;

export interface ParsedLink {
  readonly operationRef?: string;
  readonly operationId?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly requestBody?: unknown;
  readonly description?: string;
  readonly extensions: ParsedExtensions;
}

export type ParsedLinkValue = ParsedLink | ParsedRef;

export interface ParsedResponse {
  readonly description?: string;
  readonly headers: Readonly<Record<string, ParsedHeaderValue>>;
  readonly contents: readonly ParsedMediaType[];
  readonly links: Readonly<Record<string, ParsedLinkValue>>;
  readonly extensions: ParsedExtensions;
}

export interface ParsedOperationResponse extends ParsedResponse {
  readonly status: string;
}

export interface ParsedOperationMetadata {
  readonly summary?: string;
  readonly description?: string;
  readonly deprecated: boolean;
  readonly externalDocs?: ParsedExternalDocs;
}

export interface ParsedOperation {
  readonly operationId?: string;
  readonly method: HttpMethodName;
  readonly path: string;
  readonly tags: readonly string[];
  readonly metadata: ParsedOperationMetadata;
  readonly parameters: {
    readonly path: readonly ParsedParameter[];
    readonly query: readonly ParsedParameter[];
    readonly header: readonly ParsedParameter[];
    readonly cookie: readonly ParsedParameter[];
  };
  readonly requestBody?: ParsedRequestBody;
  readonly responses: readonly ParsedOperationResponse[];
  readonly defaultResponse?: ParsedResponse;
  readonly security: readonly ParsedSecurityRequirement[];
  readonly securityDeclaration: SecurityDeclaration;
  readonly extensions: ParsedExtensions;
}

export interface ParsedPathItem {
  readonly summary?: string;
  readonly description?: string;
  readonly parameters?: readonly unknown[];
  readonly get?: unknown;
  readonly put?: unknown;
  readonly post?: unknown;
  readonly delete?: unknown;
  readonly options?: unknown;
  readonly head?: unknown;
  readonly patch?: unknown;
  readonly trace?: unknown;
  readonly servers?: readonly unknown[];
  readonly extensions: ParsedExtensions;
}

export interface ParsedCallback {
  readonly expressions: Readonly<Record<string, ParsedPathItem>>;
  readonly extensions: ParsedExtensions;
}

export interface ParsedComponents {
  readonly schemas: Readonly<Record<string, ParsedSchema>>;
  readonly responses: Readonly<Record<string, ParsedResponse | ParsedRef>>;
  readonly parameters: Readonly<Record<string, ParsedParameterValue>>;
  readonly requestBodies: Readonly<Record<string, ParsedRequestBodyValue>>;
  readonly headers: Readonly<Record<string, ParsedHeaderValue>>;
  readonly pathItems: Readonly<Record<string, ParsedPathItem>>;
  readonly examples: Readonly<Record<string, ParsedExample>>;
  readonly callbacks: Readonly<Record<string, ParsedCallback>>;
}

export interface ParsedOpenApi {
  readonly openapi: string;
  readonly jsonSchemaDialect?: string;
  readonly info: ParsedInfo;
  readonly externalDocs?: ParsedExternalDocs;
  readonly servers: readonly ParsedServer[];
  readonly tags: readonly ParsedTag[];
  readonly security: readonly ParsedSecurityRequirement[];
  readonly securitySchemes: Readonly<Record<string, ParsedSecurityScheme>>;
  readonly paths: Readonly<Record<string, ParsedPathItem>>;
  readonly operations: readonly ParsedOperation[];
  readonly components: ParsedComponents;
  readonly webhooks: Readonly<Record<string, ParsedPathItem>>;
  readonly $defs: Readonly<Record<string, ParsedSchema>>;
  readonly extensions: ParsedExtensions;
}
