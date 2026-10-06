import { resolveRef, type OpenAPI3 } from "@shipworthy/openapi-typescript";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Follow an internal `$ref`. Boolean `false` is a real schema, so only `undefined` means missing. */
export function resolveDocumentRef(document: OpenAPI3, ref: string): unknown {
  const resolved = resolveRef<unknown>(document, ref, { silent: true });
  if (resolved === undefined) throw new Error(`${ref}: Unresolved reference`);
  return resolved;
}

export function resolveObject<T extends object>(
  document: OpenAPI3,
  value: T | { $ref: string },
): T {
  if (!isRecord(value) || typeof value.$ref !== "string") return value as T;
  const resolved = resolveDocumentRef(document, value.$ref);
  if (!isRecord(resolved)) throw new Error(`${value.$ref}: Unresolved reference`);
  return resolved as T;
}
