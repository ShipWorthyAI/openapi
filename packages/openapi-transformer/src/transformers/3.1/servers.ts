import { Predicate, Schema } from "effect";
import { child } from "./pointer.js";
import { readEntries, readExtensions, readString } from "./read.js";
import { ParsedExternalDocs, ParsedServer, ParsedServerVariable } from "../../model/index.js";

export function parseExternalDocs(value: unknown) {
  if (!Predicate.isObject(value)) return undefined;
  const url = readString(value.url);
  if (url === undefined) return undefined;

  return Schema.decodeSync(ParsedExternalDocs)({
    url,
    description: readString(value.description),
    extensions: readExtensions(value),
  });
}

function parseServerVariable(value: unknown) {
  if (!Predicate.isObject(value)) return undefined;
  const fallback = readString(value.default);
  if (fallback === undefined) return undefined;

  const values = Array.isArray(value.enum)
    ? value.enum.filter((entry): entry is string => typeof entry === "string")
    : [];

  return Schema.decodeSync(ParsedServerVariable)({
    default: fallback,
    enum: values.length > 0 ? values : undefined,
    description: readString(value.description),
    extensions: readExtensions(value),
  });
}

export function parseServer(value: unknown, at: string) {
  if (!Predicate.isObject(value)) return undefined;
  const url = readString(value.url);
  if (url === undefined) return undefined;
  const variables: Record<string, ParsedServerVariable> = {};

  for (const [name, entry] of readEntries(value.variables)) {
    const variable = parseServerVariable(entry);
    if (variable) variables[name] = variable;
  }

  return Schema.decodeSync(ParsedServer)({
    id: at,
    url,
    name: readString(value.name),
    description: readString(value.description),
    variables: Object.keys(variables).length > 0 ? variables : undefined,
    extensions: readExtensions(value),
  });
}

/** The servers declared at `at`, or `undefined` when there is no `servers` array. */
export function parseServerList(value: unknown, at: string) {
  if (!Array.isArray(value)) return undefined;

  return value.flatMap((entry, index) => {
    const server = parseServer(entry, child(at, index));
    return server ? [server] : [];
  });
}
