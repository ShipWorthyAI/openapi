import type { ParsedOpenApi } from "@shipworthy/openapi-parser";
import type { OpenAPI3 } from "@shipworthy/openapi-typescript";

const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

export type HttpMethod = Uppercase<(typeof methods)[number]>;
export type OperationRoute = readonly [HttpMethod, string];

const blockedOperationIds = new Set(["__proto__", "constructor", "prototype"]);

/** operationId → [METHOD, path], in document order. Every operation needs an id. */
export function operationRoutes(model: ParsedOpenApi): Record<string, OperationRoute> {
  const routes: Record<string, OperationRoute> = Object.create(null);
  for (const operation of model.operations) {
    const label = `${operation.method} ${operation.path}`;
    const id = operation.operationId;
    if (!id) throw new Error(`${label}: Missing operationId`);
    if (blockedOperationIds.has(id)) throw new Error(`Unsupported operationId: ${id}`);
    if (Object.hasOwn(routes, id)) throw new Error(`Duplicate operationId: ${id}`);
    routes[id] = [operation.method, operation.path];
  }
  return routes;
}

export function documentOf(model: ParsedOpenApi): OpenAPI3 {
  return model.document as OpenAPI3;
}
