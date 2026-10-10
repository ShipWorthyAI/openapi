import type { Generator } from "@shipworthy/openapi-generator";
import type { ParsedService } from "@shipworthy/openapi-transformer";
import { Effect, Schema } from "effect";
import { TanstackGenerationError } from "./errors.ts";
import type { OperationRoute } from "./query-utils.ts";

export { TanstackGenerationError };

const blockedOperationIds = new Set(["__proto__", "constructor", "prototype"]);

const PluginOptions = Schema.Struct({
  prefix: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
});

function reject(message: string) {
  return new TanstackGenerationError({ message });
}

/** operationId → [METHOD, path]. Every operation needs an id. */
export const operationRoutes = Effect.fnUntraced(function* (
  model: ParsedService,
): Effect.fn.Return<Record<string, OperationRoute>, TanstackGenerationError> {
  const routes: Record<string, OperationRoute> = Object.create(null);

  return yield* Effect.reduce(
    model.operations,
    () => routes,
    Effect.fnUntraced(function* (routes, operation) {
      const label = `${operation.method} ${operation.path}`;
      const id = operation.operationId;
      if (!id) return yield* reject(`${label}: Missing operationId`);
      if (blockedOperationIds.has(id)) return yield* reject(`Unsupported operationId: ${id}`);
      if (Object.hasOwn(routes, id)) return yield* reject(`Duplicate operationId: ${id}`);
      routes[id] = [operation.method as OperationRoute[0], operation.path];
      return routes;
    }),
  );
});

export const tanstackQuery: Generator<string, TanstackGenerationError> = {
  id: "tanstack-query",
  generate: Effect.fnUntraced(function* (
    model: ParsedService,
    options: Readonly<Record<string, unknown>>,
  ): Effect.fn.Return<string, TanstackGenerationError> {
    const decoded = yield* Effect.mapError(Schema.decodeEffect(PluginOptions)(options), (cause) =>
      reject(cause.message),
    );

    const prefix = decoded.prefix ?? "";
    const name = decoded.name ?? prefix;
    return clientSource(prefix, name, yield* operationRoutes(model));
  }),
};

function clientSource(
  prefix: string,
  name: string,
  routes: Record<string, OperationRoute>,
): string {
  const entries = Object.entries(routes)
    .map(([id, route]) => `  ${JSON.stringify(id)}: ${JSON.stringify(route)},`)
    .join("\n");

  return `import { createApiClient, createTanstackQueryUtils, type TanstackQueryUtilsOptions } from "@shipworthy/openapi-tanstack-query";
import type { operations, paths } from "./types";

export type { paths as ${prefix}ApiPaths, components as ${prefix}ApiComponents, operations as ${prefix}ApiOperations } from "./types";
export const create${prefix}ApiClient: typeof createApiClient<paths> = createApiClient<paths>;
export type ${prefix}ApiClient = ReturnType<typeof create${prefix}ApiClient>;

const routes = {
${entries}
} as const;

export function create${prefix}ApiQueryUtils(client: ${prefix}ApiClient, options?: Partial<TanstackQueryUtilsOptions>) {
  return createTanstackQueryUtils<Pick<operations, keyof typeof routes>>(client, routes, { prefix: ${JSON.stringify(
    name,
  )}, ...options });
}
`;
}
