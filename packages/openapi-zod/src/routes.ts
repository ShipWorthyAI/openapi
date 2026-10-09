import type { ParsedService } from "@shipworthy/openapi-transformer";
import { Effect } from "effect";
import { ZodGenerationError } from "./errors.ts";

const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

export type HttpMethod = Uppercase<(typeof methods)[number]>;
export type OperationRoute = readonly [HttpMethod, string];

const blockedOperationIds = new Set(["__proto__", "constructor", "prototype"]);

/** operationId → [METHOD, path], in document order. Every operation needs an id. */
export const operationRoutes = Effect.fnUntraced(function* (
  model: ParsedService,
): Effect.fn.Return<Record<string, OperationRoute>, ZodGenerationError> {
  const routes: Record<string, OperationRoute> = Object.create(null);

  return yield* Effect.reduce(
    model.operations,
    () => routes,
    Effect.fnUntraced(function* (routes, operation) {
      const label = `${operation.method} ${operation.path}`;
      const id = operation.operationId;
      if (!id) return yield* new ZodGenerationError({ message: `${label}: Missing operationId` });

      if (blockedOperationIds.has(id)) {
        return yield* new ZodGenerationError({ message: `Unsupported operationId: ${id}` });
      }

      if (Object.hasOwn(routes, id)) {
        return yield* new ZodGenerationError({ message: `Duplicate operationId: ${id}` });
      }

      routes[id] = [operation.method, operation.path];
      return routes;
    }),
  );
});
