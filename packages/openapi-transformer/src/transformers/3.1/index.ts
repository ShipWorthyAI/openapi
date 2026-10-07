import { Predicate, Schema } from "effect";
import type { OpenAPIDocument } from "@shipworthy/openapi-parser";
import { ParsedService } from "../../model/index.js";
import { parseCallbackMap } from "./callbacks.js";
import type { ParseContext } from "./context.js";
import { parseExampleMap } from "./examples.js";
import { parseHeaderMap } from "./headers.js";
import { parseParameterMap } from "./parameters.js";
import { parsePathItemMap } from "./paths.js";
import { readExtensions, readString } from "./read.js";
import { parseRequestBodyMap } from "./request.js";
import { parseLinkMap, parseResponseMap } from "./responses.js";
import { parseSchemaMap } from "./schemas.js";
import { parseSecurityRequirements, parseSecuritySchemeMap } from "./securities.js";
import { parseExternalDocs, parseServerList } from "./servers.js";
import { parseContact, parseLicense, parseTagList } from "./service.js";

/**
 * Parse an OpenAPI 3.1 document into the HTTP meta model. Throws `InvalidSchema` when a schema
 * position holds something that is not a schema.
 */
export function parseOpenApi3_1(doc: OpenAPIDocument) {
  const info = Predicate.isObject(doc.info) ? doc.info : {};
  const components = Predicate.isObject(doc.components) ? doc.components : {};

  const securitySchemes = parseSecuritySchemeMap(
    doc,
    components.securitySchemes,
    "#/components/securitySchemes",
  );

  const ctx: ParseContext = {
    document: doc,
    securitySchemes,
    security: parseSecurityRequirements(doc.security, securitySchemes),
    tags: parseTagList(doc.tags, "#/tags"),
    servers: parseServerList(doc.servers, "#/servers") ?? [],
  };

  const paths = parsePathItemMap(ctx, doc.paths, "#/paths", true);

  return Schema.decodeSync(ParsedService)({
    id: "#",
    openapi: doc.openapi,
    jsonSchemaDialect: readString(doc.jsonSchemaDialect),
    name: readString(info.title) ?? "",
    version: readString(info.version) ?? "",
    summary: readString(info.summary),
    description: readString(info.description),
    termsOfService: readString(info.termsOfService),
    contact: parseContact(info.contact),
    license: parseLicense(info.license),
    infoExtensions: readExtensions(info),
    externalDocs: parseExternalDocs(doc.externalDocs),
    servers: ctx.servers,
    tags: ctx.tags,
    security: ctx.security,
    securitySchemes,
    operations: Object.values(paths).flatMap((item) => item.operations),
    paths,
    webhooks: parsePathItemMap(ctx, doc.webhooks, "#/webhooks", false),
    components: {
      schemas: parseSchemaMap(components.schemas, "#/components/schemas"),
      responses: parseResponseMap(doc, components.responses, "#/components/responses"),
      parameters: parseParameterMap(doc, components.parameters, "#/components/parameters"),
      requestBodies: parseRequestBodyMap(
        doc,
        components.requestBodies,
        "#/components/requestBodies",
      ),
      headers: parseHeaderMap(doc, components.headers, "#/components/headers"),
      examples: parseExampleMap(doc, components.examples, "#/components/examples"),
      links: parseLinkMap(doc, components.links, "#/components/links"),
      callbacks: parseCallbackMap(ctx, components.callbacks, "#/components/callbacks"),
      pathItems: parsePathItemMap(ctx, components.pathItems, "#/components/pathItems", false),
    },
    $defs: parseSchemaMap(doc.$defs, "#/$defs"),
    extensions: readExtensions(doc),
  });
}
