import type { Generator } from "@shipworthy/openapi-parser";
import { documentOf, operationRoutes } from "./routes.js";
import { zodSources, type ZodSources } from "./generate.js";

export { zodSources, type ZodSources } from "./generate.js";
export { operationRoutes, type HttpMethod, type OperationRoute } from "./routes.js";

export const zod: Generator<ZodSources> = {
  id: "zod",
  generate(model, options) {
    const prefix = typeof options.prefix === "string" ? options.prefix : "";
    return zodSources(documentOf(model), prefix, operationRoutes(model));
  },
};
