import type { Generator } from "@shipworthy/openapi-generator";
import type { ParsedService } from "@shipworthy/openapi-transformer";
import type { CaseMapping } from "@shipworthy/openapi-fetch/middleware/transform-casing";
import { buildCaseMapping } from "@shipworthy/openapi-typescript/case-mapping";
import { Array, Effect, Formatter, Record, Schema, pipe } from "effect";
import { TanstackGenerationError } from "./errors.ts";
import type { OperationRoute } from "./query-utils.ts";

export { TanstackGenerationError };

const blockedOperationIds = new Set(["__proto__", "constructor", "prototype"]);

const PluginOptions = Schema.Struct({
  prefix: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  camelCase: Schema.optionalKey(Schema.Boolean),
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
      if (Record.has(routes, id)) return yield* reject(`Duplicate operationId: ${id}`);
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
    const routes = yield* operationRoutes(model);

    const mapping = decoded.camelCase
      ? yield* buildCaseMapping(model).pipe(
          Effect.mapError((error) => new TanstackGenerationError({ message: error.message })),
        )
      : undefined;

    return clientSource(prefix, name, routes, mapping);
  }),
};

function clientSource(
  prefix: string,
  name: string,
  routes: Record<string, OperationRoute>,
  mapping?: CaseMapping,
): string {
  const entries = pipe(
    Record.collect(
      routes,
      (id, route) => `  ${Formatter.formatJson(id)}: ${Formatter.formatJson(route)},`,
    ),
    Array.join("\n"),
  );

  const clientImport = mapping
    ? "createApiClient, createTanstackQueryUtils, type ApiClientOptions, type TanstackQueryUtilsOptions"
    : "createApiClient, createTanstackQueryUtils, type TanstackQueryUtilsOptions";

  const createClient = mapping
    ? `const caseMapping = ${Formatter.formatJson(mapping, { space: 2 })} as const;

export const create${prefix}ApiClient = (options: ApiClientOptions) =>
  createApiClient<paths>({ ...options, caseMapping });`
    : `export const create${prefix}ApiClient: typeof createApiClient<paths> = createApiClient<paths>;`;

  return `import { ${clientImport} } from "@shipworthy/openapi-tanstack-query";
import type { operations, paths } from "./types";

export type { paths as ${prefix}ApiPaths, components as ${prefix}ApiComponents, operations as ${prefix}ApiOperations } from "./types";
${createClient}
export type ${prefix}ApiClient = ReturnType<typeof create${prefix}ApiClient>;

const routes = {
${entries}
} as const;

export function create${prefix}ApiQueryUtils(client: ${prefix}ApiClient, options?: Partial<TanstackQueryUtilsOptions>) {
  return createTanstackQueryUtils<Pick<operations, keyof typeof routes>>(client, routes, { prefix: ${Formatter.formatJson(name)}, ...options });
}
`;
}
