import type { OpenAPI3 } from "@shipworthy/openapi-typescript";
import { bundleOpenApi } from "./bundle";
import { zodSources } from "./generate";
import { operationRoutes } from "./routes";

export { bundleOpenApi } from "./bundle";
export { zodSources, type ZodSources } from "./generate";
export { operationRoutes, type HttpMethod, type OperationRoute } from "./routes";

/** Bundle `source`, read its operations, and generate the three Zod files. */
export async function generateZodSources(source: URL | OpenAPI3, prefix: string) {
  const document = await bundleOpenApi(source);
  return zodSources(document, prefix, operationRoutes(document));
}
