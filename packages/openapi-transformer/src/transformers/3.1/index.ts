import { Effect } from "effect";
import type { OpenApiComponents, ParsedOpenApi } from "@shipworthy/openapi-parser";
import type { ParsedService } from "../../model/index.js";
import { transformCallbackMap } from "./callbacks.js";
import type { TransformContext } from "./context.js";
import { transformExampleMap } from "./examples.js";
import { transformHeaderMap } from "./headers.js";
import { transformParameterMap } from "./parameters.js";
import { transformPathItemMap } from "./paths.js";
import { readExtensions } from "./read.js";
import { transformRequestBodyMap } from "./request.js";
import { transformLinkMap, transformResponseMap } from "./responses.js";
import { transformSchemaMap } from "./schemas.js";
import { transformSecurityRequirements, transformSecuritySchemeMap } from "./securities.js";
import { transformExternalDocs, transformServerList } from "./servers.js";
import { transformContact, transformLicense, transformTagList } from "./service.js";

/** Build the encoded model; the enclosing codec performs model validation once. */
export const transformService = Effect.fnUntraced(function* (doc: ParsedOpenApi) {
  const info = doc.info;
  const components: OpenApiComponents = doc.components ?? {};

  const securitySchemes = yield* transformSecuritySchemeMap(
    doc,
    components.securitySchemes,
    "#/components/securitySchemes",
  );

  const ctx: TransformContext = {
    document: doc,
    securitySchemes,
    security: yield* transformSecurityRequirements(doc.security, securitySchemes),
    tags: yield* transformTagList(doc.tags, "#/tags"),
    servers: (yield* transformServerList(doc.servers, "#/servers")) ?? [],
  };

  const paths = yield* transformPathItemMap(ctx, doc.paths, "#/paths", true);

  return {
    id: "#",
    openapi: doc.openapi,
    jsonSchemaDialect: doc.jsonSchemaDialect,
    name: info.title,
    version: info.version,
    summary: info.summary,
    description: info.description,
    termsOfService: info.termsOfService,
    contact: yield* transformContact(info.contact),
    license: yield* transformLicense(info.license),
    infoExtensions: readExtensions(info),
    externalDocs: yield* transformExternalDocs(doc.externalDocs),
    servers: ctx.servers,
    tags: ctx.tags,
    security: ctx.security,
    securitySchemes,
    operations: Object.values(paths).flatMap((item) => item.operations),
    paths,
    webhooks: yield* transformPathItemMap(ctx, doc.webhooks, "#/webhooks", false),
    components: {
      schemas: transformSchemaMap(components.schemas),
      responses: yield* transformResponseMap(doc, components.responses, "#/components/responses"),
      parameters: yield* transformParameterMap(
        doc,
        components.parameters,
        "#/components/parameters",
      ),
      requestBodies: yield* transformRequestBodyMap(
        doc,
        components.requestBodies,
        "#/components/requestBodies",
      ),
      headers: yield* transformHeaderMap(doc, components.headers, "#/components/headers"),
      examples: yield* transformExampleMap(doc, components.examples, "#/components/examples"),
      links: yield* transformLinkMap(doc, components.links, "#/components/links"),
      callbacks: yield* transformCallbackMap(ctx, components.callbacks, "#/components/callbacks"),
      pathItems: yield* transformPathItemMap(
        ctx,
        components.pathItems,
        "#/components/pathItems",
        false,
      ),
    },
    $defs: transformSchemaMap(doc.$defs),
    extensions: readExtensions(doc),
  } satisfies typeof ParsedService.Encoded;
});
