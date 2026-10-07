import { JsonPointer, Predicate } from "effect";
import type { OpenAPIDocument } from "@shipworthy/openapi-parser";
import type { ParsedRef } from "../../model/index.js";
import { parseRef, readRef } from "./read.js";

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

export function pointer(document: OpenAPIDocument, ref: string): unknown {
  const path = tokens(ref);
  if (!path) return undefined;
  let node: unknown = document;

  for (const key of path) {
    if (Array.isArray(node)) node = node[Number(key)];
    else if (Predicate.isObject(node)) node = node[key];
    else return undefined;
  }

  return node;
}

/** Append JSON Pointer segments to a pointer. */
export function child(at: string, ...segments: readonly (string | number)[]): string {
  return segments.reduce<string>(
    (path, segment) => `${path}/${JsonPointer.escapeToken(String(segment))}`,
    at,
  );
}

export interface Resolved {
  /** The node after following local `$ref`s. `undefined` when a `$ref` points at nothing. */
  readonly value: unknown;
  /** The pointer of the node's definition. */
  readonly id: string;
  /** The Reference Object `value` was, if it was one. */
  readonly reference?: ParsedRef;
}

/** Follow local `$ref`s from `value`, which sits at pointer `at`. */
export function resolve(document: OpenAPIDocument, value: unknown, at: string): Resolved {
  const reference = parseRef(value);
  if (reference === undefined) return { value, id: at };
  const first = reference.$ref;
  const seen = new Set<string>();
  let node = value;
  let id = at;

  for (let ref: string | undefined = first; ref !== undefined; ref = readRef(node)) {
    if (!ref.startsWith("#") || seen.has(ref)) return { value: undefined, id: ref, reference };
    seen.add(ref);
    id = ref;
    node = pointer(document, ref);
  }

  return node === undefined ? { value: undefined, id, reference } : { value: node, id, reference };
}

/** Inline a `#/paths/` path item ref, keeping sibling keys. Bundling writes these for repeated path items. */
export function expandPathRef(
  document: OpenAPIDocument,
  value: unknown,
  seen = new Set<string>(),
): unknown {
  const ref = readRef(value);
  if (ref === undefined || !ref.startsWith("#/paths/") || seen.has(ref)) return value;
  seen.add(ref);

  const target = expandPathRef(document, pointer(document, ref), seen);
  const siblings: Record<string, unknown> = Predicate.isObject(value) ? { ...value } : {};
  delete siblings.$ref;

  return { ...(Predicate.isObject(target) ? target : {}), ...siblings };
}
