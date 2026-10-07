import { Predicate } from "effect";
import type { ParsedExtensions, ParsedRef } from "./types.js";

export function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function extensionsOf(value: Record<string, unknown>): ParsedExtensions {
  const extensions: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (key.startsWith("x-")) extensions[key] = entry;
  }

  return extensions;
}

export function asReference(value: unknown): ParsedRef | undefined {
  if (!Predicate.isObject(value) || typeof value.$ref !== "string") return undefined;
  if (typeof value.name === "string") return undefined;

  const summary = text(value.summary);
  const description = text(value.description);

  return {
    $ref: value.$ref,
    ...(summary !== undefined ? { summary } : {}),
    ...(description !== undefined ? { description } : {}),
  };
}

export function flag(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
