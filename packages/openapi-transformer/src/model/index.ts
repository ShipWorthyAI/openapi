/**
 * The HTTP meta model a bundled OpenAPI 3.x document parses into, as Effect Schemas. Generators
 * read this model, never the OpenAPI document. Each schema validates a model value, and its type
 * is the model type of the same name.
 *
 * The shape follows Stoplight's `IHttpService` / `IHttpOperation`: a service with flat operations,
 * a `request` per operation, responses keyed by `code`, and parameters with resolved styles.
 *
 * - `id` is the JSON Pointer of the node's definition in the bundled document. A node reached
 *   through a `$ref` takes the id of its target, so shared components share an id.
 * - A node reached through a local `$ref` is resolved, and keeps the Reference Object in
 *   `reference`. Generators can print a reference or read the resolved fields.
 * - Schemas are JSON Schema Draft 2020-12. Their `$ref`s point into the bundled document, so
 *   `components`, `paths`, `webhooks`, and `$defs` keep the document's keys.
 */

export { ParsedBodyMediaType, ParsedEncoding } from "./body-media-type.js";
export { ParsedComponents } from "./components.js";
export { ParsedExample } from "./example.js";
export { ParsedExtensions } from "./extensions.js";
export { ParsedExternalDocs } from "./external-docs.js";
export { ParsedHeader } from "./header.js";
export { HttpMethodName, httpMethods } from "./http-method.js";
export { ParsedContact, ParsedLicense } from "./info.js";
export { ParsedLink } from "./link.js";
export { ParsedMediaType } from "./media-type.js";
export { ParsedService } from "./service.js";
export { ParsedCallbackOperation, ParsedOperation } from "./operation.js";
export { ParamStyle } from "./param-style.js";
export { ParameterLocation, parameterLocations, ParsedParameter } from "./parameter.js";
export { ParsedPathItem } from "./path-item.js";
export { ParsedRef } from "./reference.js";
export { ParsedParameters, ParsedRequest, ParsedRequestBody } from "./request.js";
export { ParsedOperationResponse, ParsedResponse } from "./response.js";
export { ParsedDiscriminator, ParsedSchema } from "./schema.js";
export {
  ParsedOAuthFlow,
  ParsedOAuthFlows,
  ParsedSecurityRequirement,
  ParsedSecurityScheme,
  ParsedSecurityUse,
  SecurityDeclaration,
} from "./security.js";
export { ParsedServer, ParsedServerVariable } from "./server.js";
export { ParsedTag } from "./tag.js";
