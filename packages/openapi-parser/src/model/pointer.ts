import { JsonPointer, Predicate } from "effect";
import type { OpenAPIDocument } from "../document.js";
import { extensionsOf } from "./read.js";
import type { ParsedPathItem } from "./types.js";

/** `parseUriFragment` rejects unencoded spaces. OpenAPI path refs may contain them. */
function tokens(ref: string): readonly string[] | undefined {
  const parsed = JsonPointer.parseUriFragment(ref);
  if (parsed) return parsed;
  if (ref === "#") return [];
  if (!ref.startsWith("#/")) return undefined;

  return ref
    .slice(2)
    .split("/")
    .map((token) => JsonPointer.unescapeToken(token));
}

function at(root: unknown, path: readonly string[], missing: unknown): unknown {
  let node = root;

  for (const key of path) {
    if (Array.isArray(node)) {
      node = node[Number(key)];
      continue;
    }

    if (!Predicate.isObject(node)) return missing;
    node = node[key];
  }

  return node;
}

export function pointer(document: OpenAPIDocument, ref: string): unknown {
  const path = tokens(ref);
  if (!path) return undefined;
  return at(document, path, undefined);
}

export function resolveLocal(
  document: OpenAPIDocument,
  value: unknown,
  seen = new Set<unknown>(),
): unknown {
  if (!Predicate.isObject(value) || typeof value.$ref !== "string" || !value.$ref.startsWith("#/")) {
    return value;
  }

  if (seen.has(value)) return value;
  seen.add(value);
  const path = tokens(value.$ref);
  if (!path) return value;
  return resolveLocal(document, at(document, path, value), seen);
}

export function expandPathRef(
  document: OpenAPIDocument,
  value: unknown,
  seen = new Set<string>(),
): unknown {
  if (!Predicate.isObject(value)) return value;
  const ref = value.$ref;

  if (typeof ref !== "string" || !ref.startsWith("#/paths/")) return value;
  if (seen.has(ref)) return value;
  seen.add(ref);

  const target = pointer(document, ref);
  const resolved = expandPathRef(document, target, seen);

  const base = Predicate.isObject(resolved) ? resolved : Predicate.isObject(target) ? target : {};

  const siblings: Record<string, unknown> = { ...value };
  delete siblings.$ref;

  return { ...base, ...siblings };
}

export function pathItem(value: Record<string, unknown>): ParsedPathItem {
  return {
    ...value,
    extensions: extensionsOf(value),
  } as ParsedPathItem;
}

export function pathItems(
  value: unknown,
  document: OpenAPIDocument,
): Readonly<Record<string, ParsedPathItem>> {
  if (!Predicate.isObject(value)) return {};
  const record: Record<string, ParsedPathItem> = {};

  for (const [key, entry] of Object.entries(value)) {
    const resolved = expandPathRef(document, entry);
    if (Predicate.isObject(resolved)) record[key] = pathItem(resolved);
  }

  return record;
}
