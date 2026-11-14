import type { Middleware, MiddlewareRequestInput } from "../types.ts";

interface CaseSchema {
  readonly ref?: string;
  readonly properties?: Readonly<
    Record<string, { readonly name: string; readonly schema?: CaseSchema }>
  >;
  readonly declared?: readonly string[];
  readonly items?: CaseSchema;
  readonly prefixItems?: readonly (CaseSchema | null)[];
  readonly additionalProperties?: CaseSchema;
  readonly patternProperties?: Readonly<Record<string, CaseSchema | null>>;
  readonly variants?: readonly CaseSchema[];
}

type CaseMediaMap = Readonly<Record<string, CaseSchema | null>>;

interface CaseOperation {
  readonly parameters?: Readonly<
    Partial<Record<"path" | "query" | "header" | "cookie", CaseSchema>>
  >;
  readonly requestBodies?: CaseMediaMap;
  readonly responses?: Readonly<Record<string, CaseMediaMap | null>>;
}

export interface CaseMapping {
  readonly schemas?: Readonly<Record<string, CaseSchema>>;
  readonly operations?: Readonly<Record<string, CaseOperation>>;
}

type Direction = "toApi" | "fromApi";

interface FieldPlan {
  readonly name: string;
  readonly schemas: CaseSchema[];
  nested?: CasePlan | null;
}

interface CasePlan {
  readonly expanded: CaseSchema[];
  readonly fields: Map<string, FieldPlan>;
  readonly declared: Set<string>;
  readonly patterns: readonly { readonly regex: RegExp; readonly schema: CaseSchema | null }[];
  readonly additional: CaseSchema[];
  readonly prefixLength: number;
  prefixItems?: (CasePlan | null)[];
  items?: CasePlan | null;
  additionalPlan?: CasePlan | null;
}

function expandSchemas(
  schemas: readonly CaseSchema[],
  mapping: CaseMapping,
  visited = new Set<string>(),
): CaseSchema[] {
  return schemas.flatMap((schema) => {
    const nested = schema.variants ?? [];

    if (!schema.ref || visited.has(schema.ref)) {
      return [schema, ...expandSchemas(nested, mapping, visited)];
    }

    const referenced = mapping.schemas?.[schema.ref];
    const next = new Set(visited).add(schema.ref);

    return [schema, ...expandSchemas(referenced ? [referenced, ...nested] : nested, mapping, next)];
  });
}

function createConverter(mapping: CaseMapping) {
  const schemaIds = new WeakMap<CaseSchema, number>();
  const plans = new Map<string, CasePlan>();
  let nextId = 0;

  function planFor(schemas: readonly CaseSchema[], direction: Direction): CasePlan | undefined {
    if (schemas.length === 0) return undefined;

    const key = `${direction}:${schemas
      .map((schema) => {
        let id = schemaIds.get(schema);

        if (id === undefined) {
          id = ++nextId;
          schemaIds.set(schema, id);
        }

        return id;
      })
      .join(",")}`;

    const existing = plans.get(key);
    if (existing) return existing;

    const expanded = expandSchemas(schemas, mapping);
    const fields = new Map<string, FieldPlan>();

    for (const schema of expanded) {
      for (const [wireName, field] of Object.entries(schema.properties ?? {})) {
        const sourceName = direction === "toApi" ? field.name : wireName;
        const targetName = direction === "toApi" ? wireName : field.name;
        const current = fields.get(sourceName);

        if (current) {
          if (current.name !== targetName) {
            throw new Error(`Conflicting case mapping for ${sourceName}`);
          }

          if (field.schema) current.schemas.push(field.schema);
        } else {
          fields.set(sourceName, {
            name: targetName,
            schemas: field.schema ? [field.schema] : [],
          });
        }
      }
    }

    const plan: CasePlan = {
      expanded,
      fields,
      declared: new Set(expanded.flatMap((schema) => schema.declared ?? [])),
      patterns: expanded.flatMap((schema) =>
        Object.entries(schema.patternProperties ?? {}).map(([pattern, nested]) => ({
          regex: new RegExp(pattern),
          schema: nested,
        })),
      ),
      additional: expanded.flatMap((schema) =>
        schema.additionalProperties ? [schema.additionalProperties] : [],
      ),
      prefixLength: expanded.reduce(
        (max, schema) => Math.max(max, schema.prefixItems?.length ?? 0),
        0,
      ),
    };

    plans.set(key, plan);
    return plan;
  }

  function itemPlan(plan: CasePlan, index: number, direction: Direction): CasePlan | undefined {
    if (index >= plan.prefixLength) {
      if (plan.items === undefined) {
        plan.items =
          planFor(
            plan.expanded.flatMap((schema) => (schema.items ? [schema.items] : [])),
            direction,
          ) ?? null;
      }

      return plan.items ?? undefined;
    }

    const prefixItems = (plan.prefixItems ??= []);

    if (prefixItems[index] === undefined) {
      prefixItems[index] =
        planFor(
          plan.expanded.flatMap((schema) => {
            const prefix = schema.prefixItems;
            const item = prefix && index < prefix.length ? prefix[index] : schema.items;
            return item ? [item] : [];
          }),
          direction,
        ) ?? null;
    }

    return prefixItems[index] ?? undefined;
  }

  function convertWithPlan(
    value: unknown,
    plan: CasePlan | undefined,
    direction: Direction,
  ): unknown {
    if (!plan || value === null || value === undefined) return value;

    if (Array.isArray(value)) {
      return value.map((item, index) =>
        convertWithPlan(item, itemPlan(plan, index, direction), direction),
      );
    }

    if (typeof value !== "object") return value;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && Object.getPrototypeOf(prototype) !== null) return value;

    const convertedNames = new Set<string>();

    const entries = Object.entries(value).map(([name, item]) => {
      const field = plan.fields.get(name);
      const matched: CaseSchema[] = [];
      let hasPattern = false;

      for (const pattern of plan.patterns) {
        if (pattern.regex.test(name)) {
          hasPattern = true;
          if (pattern.schema) matched.push(pattern.schema);
        }
      }

      let nested: CasePlan | undefined;

      if (matched.length > 0) {
        nested = planFor([...(field?.schemas ?? []), ...matched], direction);
      } else if (field) {
        if (field.nested === undefined) field.nested = planFor(field.schemas, direction) ?? null;
        nested = field.nested ?? undefined;
      } else if (!plan.declared.has(name) && !hasPattern) {
        if (plan.additionalPlan === undefined) {
          plan.additionalPlan = planFor(plan.additional, direction) ?? null;
        }

        nested = plan.additionalPlan ?? undefined;
      }

      const targetName = field?.name ?? name;

      if (convertedNames.has(targetName)) {
        throw new Error(`Conflicting case mapping for ${targetName}`);
      }

      convertedNames.add(targetName);
      return [targetName, convertWithPlan(item, nested, direction)] as const;
    });

    return Object.fromEntries(entries);
  }

  return (value: unknown, schemas: readonly CaseSchema[], direction: Direction): unknown => {
    if (schemas.length === 0 || value === null || value === undefined) return value;
    return convertWithPlan(value, planFor(schemas, direction), direction);
  };
}

function isJsonMediaType(mediaType: string): boolean {
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

function mediaSchema(
  media: CaseMediaMap | null | undefined,
  contentType: string | undefined,
): CaseSchema | undefined {
  if (!media) return undefined;

  const type = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (type && !isJsonMediaType(type)) return undefined;

  const entries = Object.entries(media).filter(([name]) => isJsonMediaType(name.toLowerCase()));

  const exact = entries.find(([name]) => name.toLowerCase() === type);
  if (exact) return exact[1] ?? undefined;

  const json = entries.find(([name]) => name.toLowerCase() === "application/json");
  if (json) return json[1] ?? undefined;

  return entries.length === 1 ? (entries[0]?.[1] ?? undefined) : undefined;
}

function responseMedia(operation: CaseOperation, response: Response): CaseSchema | undefined {
  const responses = operation.responses;
  if (!responses) return undefined;

  const status = String(response.status);
  const range = `${status[0]}XX`;

  const media = Object.hasOwn(responses, status)
    ? responses[status]
    : Object.hasOwn(responses, range)
      ? responses[range]
      : responses.default;

  return mediaSchema(media, response.headers.get("content-type") ?? undefined);
}

function convertRequest(
  input: MiddlewareRequestInput,
  operation: CaseOperation,
  convertValue: ReturnType<typeof createConverter>,
  headers: Headers,
): MiddlewareRequestInput {
  const parameters = operation.parameters;
  const params = input.params;
  const bodySchema = mediaSchema(operation.requestBodies, headers.get("content-type") ?? undefined);

  return {
    params: parameters
      ? {
          ...params,
          path: convertValue(
            params.path,
            parameters.path ? [parameters.path] : [],
            "toApi",
          ) as typeof params.path,
          query: convertValue(
            params.query,
            parameters.query ? [parameters.query] : [],
            "toApi",
          ) as typeof params.query,
          header: convertValue(
            params.header,
            parameters.header ? [parameters.header] : [],
            "toApi",
          ) as typeof params.header,
          cookie: convertValue(
            params.cookie,
            parameters.cookie ? [parameters.cookie] : [],
            "toApi",
          ) as typeof params.cookie,
        }
      : params,
    body:
      bodySchema && input.body !== undefined
        ? convertValue(input.body, [bodySchema], "toApi")
        : input.body,
  };
}

/** Convert generated camelCase values at the openapi-fetch request and result stages. */
export function createCaseMappingMiddleware(mapping: CaseMapping): Middleware {
  const convertValue = createConverter(mapping);

  return {
    onRequestInit({ method, schemaPath, input, headers }) {
      const operation = mapping.operations?.[`${method} ${schemaPath}`];
      return operation ? convertRequest(input, operation, convertValue, headers) : undefined;
    },
    onResult({ method, schemaPath, result, options }) {
      const operation = mapping.operations?.[`${method} ${schemaPath}`];
      if (!operation) return;

      const schema = responseMedia(operation, result.response);
      if (!schema) return;

      return {
        ...(options.parseAs === "json" && result.data !== undefined
          ? { data: convertValue(result.data, [schema], "fromApi") }
          : {}),
        ...(result.error !== undefined
          ? { error: convertValue(result.error, [schema], "fromApi") }
          : {}),
      };
    },
  };
}
