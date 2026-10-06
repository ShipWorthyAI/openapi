import type { OpenAPI3, OperationObject, PathItemObject } from "@shipworthy/openapi-typescript";
import { isRecord, resolveObject } from "./refs";

const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

export type HttpMethod = Uppercase<(typeof methods)[number]>;
export type OperationRoute = readonly [HttpMethod, string];

const blockedOperationIds = new Set(["__proto__", "constructor", "prototype"]);

/** operationId → [METHOD, path], in document order. Every operation needs an id. */
export function operationRoutes(document: OpenAPI3): Record<string, OperationRoute> {
  const routes: Record<string, OperationRoute> = Object.create(null);
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    if (path.startsWith("x-") || !isRecord(item)) continue;
    const pathItem = resolveObject<PathItemObject>(
      document,
      item as PathItemObject | { $ref: string },
    );
    for (const method of methods) {
      const raw = pathItem[method];
      if (!raw) continue;
      const operation = resolveObject<OperationObject>(document, raw);
      const label = `${method.toUpperCase()} ${path}`;
      const id = operation.operationId;
      if (!id) throw new Error(`${label}: Missing operationId`);
      if (blockedOperationIds.has(id)) throw new Error(`Unsupported operationId: ${id}`);
      if (Object.hasOwn(routes, id)) throw new Error(`Duplicate operationId: ${id}`);
      routes[id] = [method.toUpperCase() as HttpMethod, path];
    }
  }
  return routes;
}
