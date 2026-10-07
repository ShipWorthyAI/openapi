import { Predicate } from "effect";
import type { ParsedExtensions, ParsedRef } from "../../model/index.js";

export function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function readExtensions(value: Record<string, unknown>): ParsedExtensions {
  const extensions: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (key.startsWith("x-")) extensions[key] = entry;
  }

  return extensions;
}

/** The `$ref` string on a value, before it is resolved. */
export function readRef(value: unknown): string | undefined {
  return Predicate.isObject(value) && typeof value.$ref === "string" ? value.$ref : undefined;
}

export function parseRef(value: unknown): ParsedRef | undefined {
  const ref = readRef(value);
  if (ref === undefined || !Predicate.isObject(value)) return undefined;
  const summary = readString(value.summary);
  const description = readString(value.description);

  return {
    $ref: ref,
    ...(summary !== undefined ? { summary } : {}),
    ...(description !== undefined ? { description } : {}),
  };
}

/** The entries of an object, or none. */
export function readEntries(value: unknown): readonly [string, unknown][] {
  return Predicate.isObject(value) ? Object.entries(value) : [];
}
