import { Array, Record } from "effect";
import type { CaseMapping, CaseMediaMap, CaseOperation, CaseSchema } from "./types.ts";

function hasContent(schema: CaseSchema, activeRefs: ReadonlySet<string>): boolean {
  return (
    (schema.ref !== undefined && activeRefs.has(schema.ref)) ||
    Record.toEntries(schema.properties ?? {}).length > 0 ||
    (schema.declared?.length ?? 0) > 0 ||
    (schema.items !== undefined && hasContent(schema.items, activeRefs)) ||
    (schema.additionalProperties !== undefined &&
      hasContent(schema.additionalProperties, activeRefs)) ||
    Array.some(schema.prefixItems ?? [], (item) => item !== null && hasContent(item, activeRefs)) ||
    Record.toEntries(schema.patternProperties ?? {}).length > 0 ||
    Array.some(schema.variants ?? [], (item) => hasContent(item, activeRefs))
  );
}

function activeReferences(schemas: Readonly<Record<string, CaseSchema>>): ReadonlySet<string> {
  const active = new Set<string>();
  const entries = Record.toEntries(schemas);
  let changed: boolean;

  do {
    changed = false;

    Array.forEach(entries, ([ref, schema]) => {
      if (!active.has(ref) && hasContent(schema, active)) {
        active.add(ref);
        changed = true;
      }
    });
  } while (changed);

  return active;
}

function compactSchema(
  schema: CaseSchema,
  activeRefs: ReadonlySet<string>,
): CaseSchema | undefined {
  const fields = Array.map(Record.toEntries(schema.properties ?? {}), ([wire, field]) => ({
    wire,
    name: field.name,
    nested: field.schema ? compactSchema(field.schema, activeRefs) : undefined,
  }));

  const properties = Record.fromEntries(
    Array.flatMap(fields, ({ wire, name, nested }) =>
      name !== wire || nested
        ? [[wire, { name, ...(nested ? { schema: nested } : {}) }] as const]
        : [],
    ),
  );

  const declared = [
    ...(schema.declared ?? []),
    ...Array.map(
      Array.filter(fields, ({ wire, name, nested }) => name === wire && !nested),
      ({ wire }) => wire,
    ),
  ];

  const items = schema.items ? compactSchema(schema.items, activeRefs) : undefined;

  const additional = schema.additionalProperties
    ? compactSchema(schema.additionalProperties, activeRefs)
    : undefined;

  const prefixItems = Array.map(schema.prefixItems ?? [], (item) =>
    item ? (compactSchema(item, activeRefs) ?? null) : null,
  );

  const lastPrefix = Array.reduce(prefixItems, -1, (last, item, index) => (item ? index : last));

  const keptPrefix = items ? prefixItems : Array.take(prefixItems, lastPrefix + 1);

  const patterns = Record.fromEntries(
    Array.flatMap(Record.toEntries(schema.patternProperties ?? {}), ([pattern, item]) => {
      const nested = item ? compactSchema(item, activeRefs) : undefined;
      return [[pattern, nested ?? null] as const];
    }),
  );

  const variants = Array.flatMap(schema.variants ?? [], (item) => {
    const nested = compactSchema(item, activeRefs);
    return nested ? [nested] : [];
  });

  const ref = schema.ref && activeRefs.has(schema.ref) ? schema.ref : undefined;

  if (
    !ref &&
    Record.toEntries(properties).length === 0 &&
    declared.length === 0 &&
    !items &&
    keptPrefix.length === 0 &&
    !additional &&
    Record.toEntries(patterns).length === 0 &&
    variants.length === 0
  ) {
    return undefined;
  }

  return {
    ...(ref ? { ref } : {}),
    ...(Record.toEntries(properties).length ? { properties } : {}),
    ...(declared.length ? { declared } : {}),
    ...(items ? { items } : {}),
    ...(keptPrefix.length ? { prefixItems: keptPrefix } : {}),
    ...(additional ? { additionalProperties: additional } : {}),
    ...(Record.toEntries(patterns).length ? { patternProperties: patterns } : {}),
    ...(variants.length ? { variants } : {}),
  };
}

function isJsonMediaType(mediaType: string): boolean {
  const normalized = mediaType.toLowerCase();
  return normalized === "application/json" || normalized.endsWith("+json");
}

function compactMedia(
  media: CaseMediaMap | undefined,
  activeRefs: ReadonlySet<string>,
): CaseMediaMap | undefined {
  const entries = Array.map(
    Array.filter(Record.toEntries(media ?? {}), ([name]) => isJsonMediaType(name)),
    ([name, schema]) => [name, schema ? compactSchema(schema, activeRefs) : undefined] as const,
  );

  return Array.some(entries, ([, schema]) => schema !== undefined)
    ? Record.fromEntries(Array.map(entries, ([name, schema]) => [name, schema ?? null] as const))
    : undefined;
}

function compactOperation(
  operation: CaseOperation,
  activeRefs: ReadonlySet<string>,
): CaseOperation | undefined {
  const groups = operation.parameters ?? {};

  const parameters = Record.fromEntries(
    Array.flatMap(
      [
        ["path", groups.path],
        ["query", groups.query],
        ["header", groups.header],
        ["cookie", groups.cookie],
      ] as const,
      ([location, group]): Array<readonly [string, CaseSchema]> => {
        const compacted = group ? compactSchema(group, activeRefs) : undefined;

        const fields = Array.filter(
          Record.toEntries(compacted?.properties ?? {}),
          ([wire, field]) => field.name !== wire || field.schema !== undefined,
        );

        return fields.length
          ? [[location, { properties: Record.fromEntries(fields) }] as const]
          : [];
      },
    ),
  );

  const requestBodies = compactMedia(operation.requestBodies, activeRefs);

  const candidates = Array.map(
    Record.toEntries(operation.responses ?? {}),
    ([status, media]) => [status, compactMedia(media ?? undefined, activeRefs)] as const,
  );

  const productive = new Set(
    Array.map(
      Array.filter(candidates, ([, media]) => media !== undefined),
      ([status]) => status,
    ),
  );

  const responses = Record.fromEntries(
    Array.flatMap(candidates, ([status, media]): Array<readonly [string, CaseMediaMap | null]> => {
      if (media) return [[status, media] as const];
      if (productive.size === 0 || status === "default") return [];

      const range = /^\d{3}$/.test(status) ? `${status[0]}XX` : undefined;

      return productive.has("default") || (range !== undefined && productive.has(range))
        ? [[status, null] as const]
        : [];
    }),
  );

  if (
    Record.toEntries(parameters).length === 0 &&
    requestBodies === undefined &&
    productive.size === 0
  ) {
    return undefined;
  }

  return {
    ...(Record.toEntries(parameters).length ? { parameters } : {}),
    ...(requestBodies ? { requestBodies } : {}),
    ...(productive.size ? { responses } : {}),
  };
}

export function compactCaseMapping(mapping: CaseMapping): CaseMapping {
  const activeRefs = activeReferences(mapping.schemas ?? {});

  const schemas = Record.fromEntries(
    Array.flatMap(Record.toEntries(mapping.schemas ?? {}), ([ref, schema]) => {
      if (!activeRefs.has(ref)) return [];
      const compacted = compactSchema(schema, activeRefs);
      return compacted ? [[ref, compacted] as const] : [];
    }),
  );

  const operations = Record.fromEntries(
    Array.flatMap(Record.toEntries(mapping.operations ?? {}), ([route, operation]) => {
      const compacted = compactOperation(operation, activeRefs);
      return compacted ? [[route, compacted] as const] : [];
    }),
  );

  return {
    ...(Record.toEntries(schemas).length ? { schemas } : {}),
    ...(Record.toEntries(operations).length ? { operations } : {}),
  };
}
