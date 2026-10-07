import { Predicate } from "effect";
import { unsupportedVersion, type OpenAPIDocument } from "../document.js";
import { pathItems } from "./pointer.js";
import { extensionsOf, text } from "./read.js";
import { infoOf, tagsOf } from "./service.js";
import { operationsOf } from "./operation.js";
import { callbackMap } from "./transformers/callbacks.js";
import { exampleMap } from "./transformers/examples.js";
import { headerMap } from "./transformers/headers.js";
import { parameterMap } from "./transformers/parameters.js";
import { requestBodyMap } from "./transformers/request.js";
import { responseMap } from "./transformers/responses.js";
import { schemaMap } from "./transformers/schemas.js";
import { securityRequirements, securitySchemeMap } from "./transformers/securities.js";
import { externalDocsOf, serversOf } from "./transformers/servers.js";
import type { ParsedOpenApi } from "./types.js";

export function parseModel(document: unknown): ParsedOpenApi {
  const problem = unsupportedVersion(document);
  if (problem) throw problem;
  const doc = document as OpenAPIDocument;
  const components = Predicate.isObject(doc.components) ? doc.components : {};
  const security = securityRequirements(doc.security);
  const dialect = text(doc.jsonSchemaDialect);
  const externalDocs = externalDocsOf(doc.externalDocs);

  return {
    openapi: doc.openapi,
    ...(dialect !== undefined ? { jsonSchemaDialect: dialect } : {}),
    info: infoOf(doc.info),
    ...(externalDocs ? { externalDocs } : {}),
    servers: serversOf(doc.servers),
    tags: tagsOf(doc.tags),
    security,
    securitySchemes: securitySchemeMap(components.securitySchemes),
    paths: pathItems(doc.paths, doc),
    operations: operationsOf(doc, security),
    components: {
      schemas: schemaMap(components.schemas),
      responses: responseMap(doc, components.responses),
      parameters: parameterMap(doc, components.parameters),
      requestBodies: requestBodyMap(doc, components.requestBodies),
      headers: headerMap(doc, components.headers),
      pathItems: pathItems(components.pathItems, doc),
      examples: exampleMap(components.examples),
      callbacks: callbackMap(components.callbacks),
    },
    webhooks: pathItems(doc.webhooks, doc),
    $defs: schemaMap(doc.$defs),
    extensions: extensionsOf(doc),
  };
}

export type {
  HttpMethodName,
  ParameterLocation,
  ParsedCallback,
  ParsedComponents,
  ParsedContact,
  ParsedEncoding,
  ParsedExample,
  ParsedExtensions,
  ParsedExternalDocs,
  ParsedHeader,
  ParsedHeaderValue,
  ParsedInfo,
  ParsedLicense,
  ParsedLink,
  ParsedLinkValue,
  ParsedMediaType,
  ParsedOAuthFlow,
  ParsedOAuthFlows,
  ParsedOpenApi,
  ParsedOperation,
  ParsedOperationMetadata,
  ParsedOperationResponse,
  ParsedParameter,
  ParsedParameterValue,
  ParsedPathItem,
  ParsedRef,
  ParsedRequestBody,
  ParsedRequestBodyValue,
  ParsedResponse,
  ParsedSchema,
  ParsedSecurityRequirement,
  ParsedSecurityScheme,
  ParsedServer,
  ParsedServerVariable,
  ParsedTag,
  SecurityDeclaration,
} from "./types.js";
