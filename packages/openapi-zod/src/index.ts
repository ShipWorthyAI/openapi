import type { Generator } from "@shipworthy/openapi-generator";
import type { ParsedService } from "@shipworthy/openapi-transformer";
import { Effect } from "effect";
import { ZodGenerationError } from "./errors.js";
import { zodSources, type ZodSource } from "./generate.js";
import { operationRoutes } from "./routes.js";

export { ZodGenerationError } from "./errors.js";
export { zodSources, type ZodSource } from "./generate.js";
export { operationRoutes, type HttpMethod, type OperationRoute } from "./routes.js";

export const zod: Generator<ZodSource, ZodGenerationError> = {
  id: "zod",
  generate: Effect.fnUntraced(function* (
    model: ParsedService,
  ): Effect.fn.Return<ZodSource, ZodGenerationError> {
    return yield* zodSources(model, yield* operationRoutes(model));
  }),
};
