import type { Generator } from "@shipworthy/openapi-generator";
import type { ParsedOpenApi } from "@shipworthy/openapi-parser";
import { Effect } from "effect";
import { ZodGenerationError } from "./errors.js";
import { zodSources, type ZodSources } from "./generate.js";
import { operationRoutes } from "./routes.js";

export { ZodGenerationError } from "./errors.js";
export { zodSources, type ZodSources } from "./generate.js";
export { operationRoutes, type HttpMethod, type OperationRoute } from "./routes.js";

export const zod: Generator<ZodSources, ZodGenerationError> = {
  id: "zod",
  generate: Effect.fnUntraced(function* (
    model: ParsedOpenApi,
  ): Effect.fn.Return<ZodSources, ZodGenerationError> {
    return yield* zodSources(model, yield* operationRoutes(model));
  }),
};
