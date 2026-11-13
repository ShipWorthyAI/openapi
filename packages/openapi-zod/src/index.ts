import type { Generator } from "@shipworthy/openapi-generator";
import type { ParsedService } from "@shipworthy/openapi-transformer";
import { Effect, Schema } from "effect";
import { ZodGenerationError } from "./errors.ts";
import { zodSources, type ZodSource } from "./generate.ts";
import { operationRoutes } from "./routes.ts";

export { ZodGenerationError } from "./errors.ts";
export { zodSources, type ZodSource } from "./generate.ts";
export { operationRoutes, type HttpMethod, type OperationRoute } from "./routes.ts";

export const zod: Generator<ZodSource, ZodGenerationError> = {
  id: "zod",
  generate: Effect.fnUntraced(function* (
    model: ParsedService,
    options: Readonly<Record<string, unknown>>,
  ) {
    const parsed = yield* Schema.decodeEffect(
      Schema.Struct({ outputPath: Schema.optionalKey(Schema.String) }),
    )(options).pipe(
      Effect.mapError(() => new ZodGenerationError({ message: "#: Invalid outputPath option" })),
    );

    return yield* operationRoutes(model).pipe(
      Effect.flatMap((routes) => zodSources(model, routes, parsed)),
    );
  }),
};
