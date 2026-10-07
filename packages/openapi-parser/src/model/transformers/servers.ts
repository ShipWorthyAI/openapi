import { Predicate } from "effect";
import { extensionsOf, text } from "../read.js";
import type { ParsedExternalDocs, ParsedServer, ParsedServerVariable } from "../types.js";

export function externalDocsOf(value: unknown): ParsedExternalDocs | undefined {
  if (!Predicate.isObject(value)) return undefined;
  const url = text(value.url);
  if (url === undefined) return undefined;
  const description = text(value.description);

  return {
    url,
    ...(description !== undefined ? { description } : {}),
    extensions: extensionsOf(value),
  };
}

function serverVariable(value: unknown): ParsedServerVariable | undefined {
  if (!Predicate.isObject(value)) return undefined;
  const fallback = text(value.default);
  if (fallback === undefined) return undefined;
  const description = text(value.description);

  const values = Array.isArray(value.enum)
    ? value.enum.filter((entry): entry is string => typeof entry === "string")
    : [];

  return {
    default: fallback,
    ...(values.length > 0 ? { enum: values } : {}),
    ...(description !== undefined ? { description } : {}),
    extensions: extensionsOf(value),
  };
}

export function serverOf(value: unknown): ParsedServer | undefined {
  if (!Predicate.isObject(value)) return undefined;
  const url = text(value.url);
  if (url === undefined) return undefined;
  const description = text(value.description);
  const variables: Record<string, ParsedServerVariable> = {};

  if (Predicate.isObject(value.variables)) {
    for (const [name, entry] of Object.entries(value.variables)) {
      const variable = serverVariable(entry);
      if (variable) variables[name] = variable;
    }
  }

  return {
    url,
    ...(description !== undefined ? { description } : {}),
    ...(Object.keys(variables).length > 0 ? { variables } : {}),
    extensions: extensionsOf(value),
  };
}

export function serversOf(value: unknown): readonly ParsedServer[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    const server = serverOf(entry);
    return server ? [server] : [];
  });
}
